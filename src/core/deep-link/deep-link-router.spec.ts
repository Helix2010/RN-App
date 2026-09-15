import {
  INVITE_PATH_PREFIX,
  WALLET_CONNECT_PATH,
  parseDeepLink,
} from "./deep-link-router";

describe("入站深链分发", () => {
  it("认出邀请链接并取出邀请码原文", () => {
    expect(
      parseDeepLink("https://api.example.com/app/invite/ABCD1234"),
    ).toEqual({ kind: "invite", code: "ABCD1234" });
  });

  it("邀请码原样带出，不在客户端归一化", () => {
    // 归一化只在服务端一处做；客户端各自 trim 就是第二份真相
    expect(
      parseDeepLink("https://api.example.com/app/invite/abcd-1234"),
    ).toEqual({ kind: "invite", code: "abcd-1234" });
  });

  it("百分号编码的邀请码会被解码", () => {
    expect(
      parseDeepLink("https://api.example.com/app/invite/AB%2DCD1234"),
    ).toEqual({ kind: "invite", code: "AB-CD1234" });
  });

  it("自定义 scheme 的同名路径同样认", () => {
    expect(parseDeepLink("anyfun://app/invite/ABCD1234")).toEqual({
      kind: "invite",
      code: "ABCD1234",
    });
  });

  // 路径前缀带尾斜杠：Android 的 pathPrefix 是前缀匹配，
  // 不带斜杠会把 /app/invitexyz 一并吃进来
  it("不吃掉前缀相近的别的路径", () => {
    expect(INVITE_PATH_PREFIX).toBe("/app/invite/");
    expect(
      parseDeepLink("https://api.example.com/app/invitexyz/ABCD1234").kind,
    ).toBe("unknown");
  });

  it("邀请码为空时不认", () => {
    expect(parseDeepLink("https://api.example.com/app/invite/").kind).toBe(
      "unknown",
    );
  });

  // 一个 dispatcher 管两条路径：起两套监听会让两个功能互相吃掉对方的链接
  it("认出 WalletConnect 回跳并与邀请分开", () => {
    expect(
      parseDeepLink(`https://api.example.com${WALLET_CONNECT_PATH}`),
    ).toEqual({ kind: "walletconnect" });
    expect(
      parseDeepLink(`https://api.example.com${WALLET_CONNECT_PATH}/whatever`),
    ).toEqual({ kind: "walletconnect" });
  });

  it("不认识的链接返回 unknown，不猜", () => {
    expect(parseDeepLink("https://api.example.com/").kind).toBe("unknown");
    expect(parseDeepLink("https://api.example.com/app/other").kind).toBe(
      "unknown",
    );
  });

  it("不是合法 URL 时返回 unknown 而不是抛错", () => {
    expect(parseDeepLink("not a url").kind).toBe("unknown");
    expect(parseDeepLink("").kind).toBe("unknown");
  });
});
