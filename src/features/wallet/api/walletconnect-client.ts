import Constants from "expo-constants";
import { Linking } from "react-native";
import {
  isWalletConnectConfigured,
  onWalletConfigChange,
  walletConnectProjectId,
  walletNetworks,
} from "../../../core/wallet/config/wallet-runtime-config";
import type { WalletConnectorId } from "../../session/model/session";
import { launchLinks, probeLinks } from "./wallet-deep-links";
import {
  WalletConnectConnector,
  WalletConnectUnavailableError,
  type SignClientLike,
} from "./walletconnect-connector";

/**
 * 真实 WalletConnect 客户端的装配。SDK 是惰性 import 的：没有 projectId 时
 * 根本不会初始化，UI 会把外部钱包如实标记为不可用。
 */

let clientPromise: Promise<SignClientLike> | null = null;

// projectId 变了就丢弃已建的客户端，下次连接用新的
onWalletConfigChange(() => {
  clientPromise = null;
});

/** 本 App 的身份：钱包里会显示它，批准后也按它回跳。 */
/**
 * 展示给对端钱包的应用身份，来自租户构建配置（tenant.json → app.config.ts）。
 * 两项都是构建期必填：缺了或不合法就是构建坏了，抛错而不是换一个域名顶上。
 */
function appIdentity(): { url: string; native: string } {
  const extra = Constants.expoConfig?.extra as
    { apiBaseUrl?: string } | undefined;
  const scheme = Constants.expoConfig?.scheme;
  if (typeof scheme !== "string" || scheme.length === 0)
    throw new Error("app scheme is not configured for this tenant build");
  if (!extra?.apiBaseUrl)
    throw new Error("apiBaseUrl is not configured for this tenant build");
  return { url: new URL(extra.apiBaseUrl).origin, native: `${scheme}://` };
}

async function createClient(appName: string): Promise<SignClientLike> {
  const projectId = walletConnectProjectId();
  if (!projectId) throw new WalletConnectUnavailableError();
  const identity = appIdentity();
  // 动态 import：Metro 会把它切成单独的模块，未配置时不进启动路径
  const { SignClient } = await import("@walletconnect/sign-client");
  const client = await SignClient.init({
    projectId,
    metadata: {
      name: appName,
      description: `${appName} mobile`,
      url: identity.url,
      icons: [],
      // 没有 redirect，用户在钱包里点完批准会停在钱包里，回到 App 才看到结果
      redirect: { native: identity.native },
    },
  });
  return client as unknown as SignClientLike;
}

/**
 * 依次尝试候选深链。
 *
 * **不要用 `canOpenURL` 做前置判断**：Android 11+ 的 package visibility 会让它
 * 对未在 manifest `<queries>` 里声明的 scheme 一律返回 false，哪怕钱包装着。
 * `openURL` 走 startActivity，不受这个限制，所以直接开、开不了再退。
 */
async function openFirstAvailable(links: string[]): Promise<boolean> {
  for (const link of links) {
    try {
      await Linking.openURL(link);
      return true;
    } catch {
      // 这个 scheme 打不开就试下一个（OKX 有两个 App）
    }
  }
  return false;
}

/** 探测钱包是否安装。依赖 manifest 的 queries 声明，探不到就当没装。 */
export async function isWalletInstalled(
  connector: WalletConnectorId,
): Promise<boolean> {
  for (const link of probeLinks(connector)) {
    try {
      if (await Linking.canOpenURL(link)) return true;
    } catch {
      // 这个 scheme 探不到就试下一个候选
    }
  }
  return false;
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
    deepLinks: string[];
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
    // 每次读一次：链目录随 bootstrap 变，不能在创建时定死
    networks: () =>
      walletNetworks().map((network) => ({
        id: network.id,
        chainId: network.chainId,
      })),
    available: isWalletConnectConfigured,
    installed: isWalletInstalled,
    openWallet: async (connector) => {
      await openFirstAvailable(launchLinks(connector));
    },
  });
}

/** 默认的 present：能唤起钱包就唤起，否则把 URI 交给回调（二维码 / 复制）。 */
export async function openWalletOrFallback(
  input: { uri: string; connector: WalletConnectorId; deepLinks?: string[] },
  fallback: (uri: string) => void,
): Promise<void> {
  const links = (input.deepLinks ?? []).map(
    (link) => `${link}${encodeURIComponent(input.uri)}`,
  );
  if (await openFirstAvailable(links)) return;
  fallback(input.uri);
}
