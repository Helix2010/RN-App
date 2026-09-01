import { create } from "zustand";
import type { WalletConnectorId } from "../../session/model/session";

/**
 * WalletConnect 配对 URI 的全局状态。连接器只负责把 URI 放进来，
 * 由根组件挂载的 sheet 展示二维码 / 唤起钱包 —— 和登录 sheet 同一套模式。
 */
/**
 * 为什么会看到二维码：
 * - `scan` 用户自己选的"其他钱包"
 * - `wallet-missing` 本来要唤起某个钱包但机器上没装，退回扫码
 *
 * 区分它们是为了把话说清楚：用户点了 MetaMask 却看到二维码，必须告诉他原因，
 * 否则就是"点了没反应"。
 */
type PairingReason = "scan" | "wallet-missing";

type WalletConnectPairingState = {
  uri: string | null;
  connector: WalletConnectorId | null;
  reason: PairingReason;
  present: (input: {
    uri: string;
    connector: WalletConnectorId;
    reason: PairingReason;
  }) => void;
  dismiss: () => void;
};

export const useWalletConnectPairing = create<WalletConnectPairingState>(
  (set) => ({
    uri: null,
    connector: null,
    reason: "scan",
    present: ({ uri, connector, reason }) => set({ uri, connector, reason }),
    dismiss: () => {
      const wasOpen = Boolean(useWalletConnectPairing.getState().uri);
      set({ uri: null, connector: null, reason: "scan" });
      if (wasOpen) for (const listener of dismissListeners) listener();
    },
  }),
);

const dismissListeners = new Set<() => void>();

/**
 * 用户关掉二维码就等于放弃这次连接。不通知连接器的话，底层还在等 approval，
 * 状态机停在 connecting，用户再点别的钱包就会串。
 */
export function onPairingDismissed(listener: () => void): () => void {
  dismissListeners.add(listener);
  return () => dismissListeners.delete(listener);
}

export function presentWalletConnectUri(
  uri: string,
  connector: WalletConnectorId,
  reason: PairingReason = "scan",
): void {
  useWalletConnectPairing.getState().present({ uri, connector, reason });
}
