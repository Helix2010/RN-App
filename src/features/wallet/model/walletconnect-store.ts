import { create } from "zustand";
import type { WalletConnectorId } from "../../session/model/session";

/**
 * WalletConnect 配对 URI 的全局状态。连接器只负责把 URI 放进来，
 * 由根组件挂载的 sheet 展示二维码 / 唤起钱包 —— 和登录 sheet 同一套模式。
 */
type WalletConnectPairingState = {
  uri: string | null;
  connector: WalletConnectorId | null;
  present: (input: { uri: string; connector: WalletConnectorId }) => void;
  dismiss: () => void;
};

export const useWalletConnectPairing = create<WalletConnectPairingState>(
  (set) => ({
    uri: null,
    connector: null,
    present: ({ uri, connector }) => set({ uri, connector }),
    dismiss: () => set({ uri: null, connector: null }),
  }),
);

export function presentWalletConnectUri(
  uri: string,
  connector: WalletConnectorId,
): void {
  useWalletConnectPairing.getState().present({ uri, connector });
}
