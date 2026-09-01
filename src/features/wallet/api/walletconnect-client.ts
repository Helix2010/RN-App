import { Linking } from "react-native";
import type { ChainId } from "../../../core/gateways/types";
import type { WalletConnectorId } from "../../session/model/session";
import {
  WalletConnectConnector,
  WalletConnectUnavailableError,
  type SignClientLike,
} from "./walletconnect-connector";

/**
 * 真实 WalletConnect 客户端的装配。SDK 是惰性 import 的：没有 projectId 时
 * 根本不会初始化，UI 会把外部钱包如实标记为不可用。
 */

const WALLET_CONNECT_METADATA_URL = "https://walletconnect.com";

/**
 * 钱包参数**只**来自服务端 bootstrap（按租户下发）。这里没有构建期兜底：
 * projectId 是租户配置而不是构建参数，混两条来源会让"某台机器能连、CI 出的包
 * 不能连"这类问题无法排查。
 */
let delivered: { projectId: string | null; chains: ChainId[] } | null = null;

export function applyDeliveredWalletConfig(config: {
  walletConnectProjectId: string;
  chains: ChainId[];
}): void {
  const projectId = config.walletConnectProjectId.trim() || null;
  const changed = delivered?.projectId !== projectId;
  delivered = { projectId, chains: config.chains };
  // projectId 变了就丢弃已建的客户端，下次连接用新的
  if (changed) clientPromise = null;
}

export function walletConnectProjectId(): string | null {
  return delivered?.projectId ?? null;
}

export function walletConnectChains(): ChainId[] {
  return delivered?.chains ?? ["bsc", "eth", "base"];
}

export function isWalletConnectConfigured(): boolean {
  return walletConnectProjectId() !== null;
}

let clientPromise: Promise<SignClientLike> | null = null;

async function createClient(appName: string): Promise<SignClientLike> {
  const projectId = walletConnectProjectId();
  if (!projectId) throw new WalletConnectUnavailableError();
  // 动态 import：Metro 会把它切成单独的模块，未配置时不进启动路径
  const { SignClient } = await import("@walletconnect/sign-client");
  const client = await SignClient.init({
    projectId,
    metadata: {
      name: appName,
      description: `${appName} mobile`,
      url: WALLET_CONNECT_METADATA_URL,
      icons: [],
    },
  });
  return client as unknown as SignClientLike;
}

/**
 * 创建外部钱包连接器。
 *
 * @param present 展示连接入口（唤起钱包深链，或把 URI 交给二维码界面）
 */
export function createWalletConnectConnector(options: {
  appName: string;
  present: (input: {
    uri: string;
    connector: WalletConnectorId;
    deepLink?: string;
  }) => Promise<void>;
}): WalletConnectConnector {
  // 始终注入：可用性由 `isWalletConnectConfigured()` 动态判定，因为 projectId
  // 是启动后才由 bootstrap 下发的。
  return new WalletConnectConnector({
    client: () => {
      clientPromise ??= createClient(options.appName);
      return clientPromise;
    },
    present: options.present,
    chains: walletConnectChains(),
    available: isWalletConnectConfigured,
    openWallet: async (connector) => {
      const link = walletDeepLink(connector);
      if (!link) return;
      // 只在钱包确实装了的时候切过去；没装就留在本应用里，由 UI 提示
      if (await Linking.canOpenURL(link)) await Linking.openURL(link);
    },
  });
}

function walletDeepLink(connector: WalletConnectorId): string | null {
  switch (connector) {
    case "metamask":
      return "metamask://";
    case "okx":
      return "okx://";
    case "trust":
      return "trust://";
    default:
      return null;
  }
}

/** 默认的 present：能唤起钱包就唤起，否则把 URI 交给回调（二维码 / 复制）。 */
export async function openWalletOrFallback(
  input: { uri: string; connector: WalletConnectorId; deepLink?: string },
  fallback: (uri: string) => void,
): Promise<void> {
  if (input.deepLink) {
    const url = `${input.deepLink}${encodeURIComponent(input.uri)}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // 深链不可用就退回二维码
    }
  }
  fallback(input.uri);
}
