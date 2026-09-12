import {
  requestWalletPassphrase,
  usePassphrasePrompt,
} from "./passphrase-prompt";

beforeEach(() => {
  usePassphrasePrompt.setState({
    open: false,
    purpose: "unlock",
    retry: false,
    resolve: null,
  });
});

describe("钱包口令输入通道", () => {
  it("提交后把口令交回给金库", async () => {
    const pending = requestWalletPassphrase("unlock", false);
    expect(usePassphrasePrompt.getState().open).toBe(true);

    usePassphrasePrompt.getState().submit("correct horse");

    await expect(pending).resolves.toBe("correct horse");
    expect(usePassphrasePrompt.getState().open).toBe(false);
  });

  // 取消不是口令错误：金库据此抛 PassphraseRequired，界面才分得开两件事
  it("取消交回 null", async () => {
    const pending = requestWalletPassphrase("unlock", false);

    usePassphrasePrompt.getState().cancel();

    await expect(pending).resolves.toBeNull();
  });

  it("第二次请求会先了结上一发，不留悬着的 promise", async () => {
    const first = requestWalletPassphrase("unlock", false);
    const second = requestWalletPassphrase("reveal", false);

    await expect(first).resolves.toBeNull();
    usePassphrasePrompt.getState().submit("x");
    await expect(second).resolves.toBe("x");
  });

  it("重试时带上上次错了的标记，界面才能给出反馈而不是一个沉默的输入框", async () => {
    void requestWalletPassphrase("unlock", true);

    expect(usePassphrasePrompt.getState().retry).toBe(true);
    usePassphrasePrompt.getState().cancel();
    expect(usePassphrasePrompt.getState().retry).toBe(false);
  });

  it("用途会传给界面：解锁和查看助记词说的不是同一句话", () => {
    void requestWalletPassphrase("reveal", false);
    expect(usePassphrasePrompt.getState().purpose).toBe("reveal");
  });
});
