import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import type { PredictAccountGateway } from "../../features/predict/api/account-gateway";
import { HttpPredictAccountGateway } from "../../features/predict/api/http-predict-account-gateway";
import { PredictCredentialStore } from "../predict-platform/credentials";
import type { DexGateway } from "../../features/dex/api/gateway";
import { MockDexGateway } from "../../features/dex/api/mock-dex-gateway";
import type { PredictGateway } from "../../features/predict/api/gateway";
import { HttpPredictGateway } from "../../features/predict/api/http-predict-gateway";
import type { SessionGateway } from "../../features/session/api/gateway";
import { HttpSessionGateway } from "../../features/session/api/http-session-gateway";
import type { WalletGateway } from "../../features/wallet/api/gateway";
import { EmbeddedWalletGateway } from "../../features/wallet/api/embedded-wallet-gateway";
import { HttpWalletIndex } from "../../features/wallet/api/http-wallet-index";
import {
  createWalletConnectConnector,
  openWalletOrFallback,
} from "../../features/wallet/api/walletconnect-client";
import {
  onPairingDismissed,
  presentWalletConnectUri,
} from "../../features/wallet/model/walletconnect-store";
import { MockWalletGateway } from "../../features/wallet/api/mock-wallet-gateway";
import { OnchainTransfers } from "../../features/wallet/api/onchain-transfers";
import { KeystoreVault } from "../wallet/vault/keystore-vault";
import { expoAuthenticate, expoSecureStore } from "../wallet/vault/expo-ports";
import { appRuntime } from "../network/api-client";
import { setSessionStateProbe } from "../device/session-state-probe";
import type { KeyValueStorage } from "./types";

export type Gateways = {
  session: SessionGateway;
  wallet: WalletGateway;
  predict: PredictGateway;
  /** 预测账户：真实平台，没有 Mock 实现 */
  predictAccount: PredictAccountGateway;
  dex: DexGateway;
  /** 丢弃内存中的钱包解锁态；应用上锁 / 进后台时调用 */
  lockKeys: () => void;
};

const GatewayContext = createContext<Gateways | null>(null);

/**
 * 组装网关。**钱包密钥与签名是真的**（KeystoreVault + EmbeddedSigner）；
 * 会话、预测行情与账户、链上转出都接真实服务；只有 DEX 仍是 Mock（尚未接入），
 * 演示账本余额由 `chainData` 注入。接真实 DEX 时只替换这里。
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
  // 不取消订阅：createGateways 由 useMemo 在整个 App 生命周期里只跑一次，
  // 而 cancelConnect 是幂等的，万一 memo 被丢弃重算也只是多调一次空操作
  onPairingDismissed(() => external.cancelConnect());
  // 真实链上转出。签名器由网关在每次转账时按账户解析后传进来，所以这里不需要
  // 反向引用网关。
  const onchain = new OnchainTransfers({
    reason: "wallet.sign.transfer",
    storage,
  });
  // 会话是真的：挑战由 RN-Server 构造并核销 nonce，签名换回的令牌进安全存储。
  // 测试通过 GatewayProvider 注入 Mock 会话，不走这条路径。
  const session = new HttpSessionGateway(storage);
  // 心跳顺带上报客户端登录态给服务端对账；本地缓存的会话过期即视为未登录
  setSessionStateProbe(async () =>
    (await session.get()) ? "signed_in" : "signed_out",
  );
  const wallet = new EmbeddedWalletGateway({
    vault,
    chainData,
    storage,
    external,
    onchain,
    // 链上收款与转出记录来自平台扫链索引，按会话地址查询
    index: new HttpWalletIndex({ session }),
    seedDemoBalances: (address) => chainData.seedDemoBalances(address),
  });
  // 预测账户接真实平台：没有 services.predict 下发时账户功能如实不可用
  const predictAccount = new HttpPredictAccountGateway({
    wallet,
    onchain,
    credentials: new PredictCredentialStore(expoSecureStore),
    storage,
  });
  // 行情 / 持仓 / 订单同样直连平台；还没接的能力如实抛错，没有演示数据
  const predict = new HttpPredictGateway({
    account: predictAccount,
    wallet,
    onchain,
  });
  const dex = new MockDexGateway(storage, wallet);
  return {
    session,
    wallet,
    predict,
    predictAccount,
    dex,
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
