import { create } from "zustand";

/**
 * 钱包口令的输入通道（安全评审 N6 / 方案 §3.5、§3.6）。
 *
 * 金库在两种时候需要口令：系统把认证绑定的那把密钥作废了（用户新录指纹、换锁屏），
 * 以及用户要查看助记词。两种都发生在金库内部，而金库不能 import 任何 UI——它的
 * 能力边界只有"安全存储 + 身份验证 + 随机数"。所以这里用一个全局的 promise 通道
 * 把请求交给界面，金库拿到的只是一个 `() => Promise<string | null>`。
 *
 * `null` = 用户取消。**取消不是口令错误**：金库据此抛
 * `WalletPassphraseRequiredError`，界面才能区分"用户不想输"和"输错了"。
 */

export type PassphrasePurpose = "unlock" | "reveal";

type State = {
  open: boolean;
  purpose: PassphrasePurpose;
  /** 上一次输错了。界面据此显示"口令不对"，而不是一个没有反馈的输入框。 */
  retry: boolean;
  resolve: ((value: string | null) => void) | null;
  request: (
    purpose: PassphrasePurpose,
    retry: boolean,
  ) => Promise<string | null>;
  submit: (passphrase: string) => void;
  cancel: () => void;
};

export const usePassphrasePrompt = create<State>((set, get) => ({
  open: false,
  purpose: "unlock",
  retry: false,
  resolve: null,
  request: (purpose, retry) =>
    new Promise<string | null>((resolve) => {
      // 上一发还挂着就先了结它：两个未决的 promise 会让调用方永远等下去
      get().resolve?.(null);
      set({ open: true, purpose, retry, resolve });
    }),
  submit: (passphrase) => {
    const { resolve } = get();
    set({ open: false, resolve: null });
    resolve?.(passphrase);
  },
  cancel: () => {
    const { resolve } = get();
    set({ open: false, resolve: null, retry: false });
    resolve?.(null);
  },
}));

/** 注入给金库的端口。金库只看得见这一个函数。 */
export function requestWalletPassphrase(
  purpose: PassphrasePurpose,
  retry: boolean,
): Promise<string | null> {
  return usePassphrasePrompt.getState().request(purpose, retry);
}
