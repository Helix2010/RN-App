import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Linking } from "react-native";
import type { KeyValueStorage } from "../../../core/gateways/types";
import { expoSecureStoreIn } from "../../../core/wallet/vault/expo-ports";
import { createEncryptedWcStorage } from "./encrypted-wc-storage";
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

/** WalletConnect 存储密钥独占的钥匙串服务，和钱包私钥分开。 */
const WC_KEYCHAIN_SERVICE = "foundation.walletconnect";

const asyncStorageAdapter: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

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

/**
 * SDK 升级前写下的明文条目。默认存储把会话（含 symKey）直接写这些键，
 * 换成加密存储后它们不会再被读到，但明文还留在盘上，得删掉（安全评审 N14）。
 */
const LEGACY_WC_KEYS = [
  "wc@2:core:0.3//keychain",
  "wc@2:core:0.3//messages",
  "wc@2:core:0.3//subscription",
  "wc@2:core:0.3//history",
  "wc@2:core:0.3//expirer",
  "wc@2:core:0.3//pairing",
  "wc@2:client:0.3//proposal",
  "wc@2:client:0.3//session",
  "wc@2:client:0.3//request",
];

async function createClient(appName: string): Promise<SignClientLike> {
  const projectId = walletConnectProjectId();
  if (!projectId) throw new WalletConnectUnavailableError();
  const identity = appIdentity();
  // 会话对称密钥不进普通存储：加密后落盘，密钥放系统密钥库（安全评审 N14）。
  // 换存储等于旧会话读不到，用户需要重连一次——这是一次性成本。
  const storage = createEncryptedWcStorage({
    secure: expoSecureStoreIn(WC_KEYCHAIN_SERVICE),
    storage: asyncStorageAdapter,
  });
  await storage.purgeLegacy(LEGACY_WC_KEYS);
  // 动态 import：Metro 会把它切成单独的模块，未配置时不进启动路径
  const { SignClient } = await import("@walletconnect/sign-client");
  const client = await SignClient.init({
    storage,
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
