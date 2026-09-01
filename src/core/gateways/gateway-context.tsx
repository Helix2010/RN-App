import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import type { AssetsGateway } from "../../features/assets/api/gateway";
import { MockAssetsGateway } from "../../features/assets/api/mock-assets-gateway";
import type { DexGateway } from "../../features/dex/api/gateway";
import { MockDexGateway } from "../../features/dex/api/mock-dex-gateway";
import type { PredictGateway } from "../../features/predict/api/gateway";
import { MockPredictGateway } from "../../features/predict/api/mock-predict-gateway";
import type { SessionGateway } from "../../features/session/api/gateway";
import { HttpSessionGateway } from "../../features/session/api/http-session-gateway";
import type { WalletGateway } from "../../features/wallet/api/gateway";
import { EmbeddedWalletGateway } from "../../features/wallet/api/embedded-wallet-gateway";
import {
  createWalletConnectConnector,
  openWalletOrFallback,
} from "../../features/wallet/api/walletconnect-client";
import {
  onPairingDismissed,
  presentWalletConnectUri,
} from "../../features/wallet/model/walletconnect-store";
import { MockWalletGateway } from "../../features/wallet/api/mock-wallet-gateway";
import { KeystoreVault } from "../wallet/vault/keystore-vault";
import { expoAuthenticate, expoSecureStore } from "../wallet/vault/expo-ports";
import { appRuntime } from "../network/api-client";
import type { KeyValueStorage } from "./types";

export type Gateways = {
  session: SessionGateway;
  wallet: WalletGateway;
  predict: PredictGateway;
  dex: DexGateway;
  assets: AssetsGateway;
  /** 业务数据来源；密钥与签名始终是真的 */
  mode: "mock" | "live";
  /** 丢弃内存中的钱包解锁态；应用上锁 / 进后台时调用 */
  lockKeys: () => void;
};

const GatewayContext = createContext<Gateways | null>(null);

/**
 * 组装网关。**钱包密钥与签名是真的**（KeystoreVault + EmbeddedSigner）；
 * 余额 / 转账 / 预测 / 兑换等业务数据一期仍是 Mock，由 `chainData` 注入，
 * 接真实链与后端时只替换这里。Http 会话实现（P2）同样在此按 bootstrap.services 选择。
 */
function createGateways(storage: KeyValueStorage): Gateways {
  const vault = new KeystoreVault({
    storage,
    secureStore: expoSecureStore,
    authenticate: expoAuthenticate,
  });
  const chainData = new MockWalletGateway(storage);
  // 外部钱包：projectId 由服务端 bootstrap 下发，没下发时 UI 如实标记不可用
  const external = createWalletConnectConnector({
    appName: appRuntime.applicationId,
    present: (input) =>
      openWalletOrFallback(input, (uri) =>
        presentWalletConnectUri(
          uri,
          input.connector,
          // 有候选深链却走到这里 = 本机没装这个钱包，UI 要说明白
          input.deepLinks.length > 0 ? "wallet-missing" : "scan",
        ),
      ),
  });
  onPairingDismissed(() => external.cancelConnect());
  const wallet = new EmbeddedWalletGateway({
    vault,
    chainData,
    storage,
    external,
    seedDemoBalances: (address) => chainData.seedDemoBalances(address),
  });
  // 会话是真的：挑战由 RN-Server 构造并核销 nonce，签名换回的令牌进安全存储。
  // 测试通过 GatewayProvider 注入 Mock 会话，不走这条路径。
  const session = new HttpSessionGateway(storage);
  const predict = new MockPredictGateway(storage);
  const dex = new MockDexGateway(storage, wallet);
  const assets = new MockAssetsGateway(wallet, predict);
  return {
    session,
    wallet,
    predict,
    dex,
    assets,
    mode: "mock",
    lockKeys: () => vault.lock(),
  };
}

export function GatewayProvider({
  children,
  gateways,
}: PropsWithChildren<{ gateways?: Gateways }>) {
  const value = useMemo(
    () => gateways ?? createGateways(AsyncStorage),
    [gateways],
  );
  return (
    <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>
  );
}

export function useGateways(): Gateways {
  const value = useContext(GatewayContext);
  if (!value)
    throw new Error("useGateways must be used inside GatewayProvider");
  return value;
}
