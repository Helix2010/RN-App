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
import { MockSessionGateway } from "../../features/session/api/mock-session-gateway";
import type { WalletGateway } from "../../features/wallet/api/gateway";
import { MockWalletGateway } from "../../features/wallet/api/mock-wallet-gateway";
import type { KeyValueStorage } from "./types";

export type Gateways = {
  session: SessionGateway;
  wallet: WalletGateway;
  predict: PredictGateway;
  dex: DexGateway;
  assets: AssetsGateway;
  /** 一期恒为 mock；接真后由 bootstrap.services.mode 决定 */
  mode: "mock" | "live";
};

const GatewayContext = createContext<Gateways | null>(null);

/**
 * 组装一套 Mock 网关。业务层只依赖接口，切换实现只改这里。
 * Http 实现（P6）同样在此按 bootstrap.services 选择。
 */
function createMockGateways(storage: KeyValueStorage): Gateways {
  const session = new MockSessionGateway(storage);
  const wallet = new MockWalletGateway(storage);
  const predict = new MockPredictGateway(storage);
  const dex = new MockDexGateway(storage, wallet);
  const assets = new MockAssetsGateway(wallet, predict);
  return { session, wallet, predict, dex, assets, mode: "mock" };
}

export function GatewayProvider({
  children,
  gateways,
}: PropsWithChildren<{ gateways?: Gateways }>) {
  const value = useMemo(
    () => gateways ?? createMockGateways(AsyncStorage),
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
