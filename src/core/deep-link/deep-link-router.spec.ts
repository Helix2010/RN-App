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

// `anyfun:///app/invite/X`（三斜杠）是 Linking.createURL('/…') 的产出形态，
// 也是人手写自定义 scheme 链接最常见的写法之一。它的 host 是空串，
// 拼出来是 //app/...，不折斜杠就会被判成 unknown，整条深链静默失效。
describe("自定义 scheme 的两种写法", () => {
  it("三斜杠（空 authority）与两斜杠等价", () => {
    expect(parseDeepLink("anyfun:///app/invite/ABCD1234")).toEqual({
      kind: "invite",
      code: "ABCD1234",
    });
    expect(parseDeepLink("anyfun:///app/wc")).toEqual({
      kind: "walletconnect",
    });
  });

  // 非特殊 scheme 的 host 不会被 URL 自动小写
  it("host 大小写不影响识别，但邀请码原文不动", () => {
    expect(parseDeepLink("anyfun://APP/invite/abcd1234")).toEqual({
      kind: "invite",
      code: "abcd1234",
    });
  });
});

// AGENTS.md「安全与隐私」：深链参数必须在边界校验。
// 这里只拒绝明显不成形的输入，**不做归一化**——归一化只在服务端一处。
describe("邀请码原文的边界校验", () => {
  it("超长的段落不进暂存", () => {
    const huge = "A".repeat(2048);
    expect(parseDeepLink(`https://api.example.com/app/invite/${huge}`)).toEqual(
      {
        kind: "unknown",
      },
    );
  });

  it("百分号转义解出来的控制字符不进暂存", () => {
    expect(parseDeepLink("https://api.example.com/app/invite/AB%00CD")).toEqual(
      {
        kind: "unknown",
      },
    );
  });

  it("残缺的百分号转义按认不出处理，不抛", () => {
    expect(parseDeepLink("https://api.example.com/app/invite/AB%ZZ")).toEqual({
      kind: "unknown",
    });
  });

  // 合法原文可以带分隔符与全角字符，长度本来就不等于 8：不能在这里判死
  it("带连字符、空格与全角的原文照样放行，交服务端归一化", () => {
    expect(
      parseDeepLink("https://api.example.com/app/invite/ABCD-1234"),
    ).toEqual({ kind: "invite", code: "ABCD-1234" });
    expect(
      parseDeepLink("https://api.example.com/app/invite/%EF%BC%A1BCD1234"),
    ).toEqual({ kind: "invite", code: "ＡBCD1234" });
  });
});
