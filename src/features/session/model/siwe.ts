/**
 * 客户端复核服务端下发的 EIP-4361（Sign-In with Ethereum）登录消息。
 *
 * 为什么要复核：这条消息是用户真正要签的那份明文，签名一旦给出去就可以被
 * 拿到任何接受同样消息的地方去用。服务端（或中间人改包）把 `domain` 换成
 * 别家、把 `Address` 换成另一个账户、或者塞一个我们没见过的 `Nonce`，
 * 客户端如果照签，就等于替别人换了一张登录凭证（安全评审 N26）。
 *
 * 这里只做"我们本来就知道答案"的断言：域名必须是本 App 的 API 域名，
 * 地址必须是当前要登录的账户，nonce 必须是刚拿到的那一个。
 */

export type SiweFields = {
  domain: string;
  address: string;
  uri: string | null;
  chainId: number | null;
  nonce: string | null;
  issuedAt: string | null;
  expirationTime: string | null;
};

/**
 * 取出可比较的主机名。
 *
 * 服务端渲染消息时用的是**去掉端口**的 Host（`net.SplitHostPort`，见 RN-Server
 * `normalizeHost`），而客户端手里的 `domain` 来自 `new URL(apiBaseUrl).host`，
 * 带端口。生产域名没有端口，两边碰巧一致；开发 / 预发环境（`http://10.0.2.2:3100`）
 * 一比就不等，登录会被这道检查直接挡死。所以比较前统一去掉端口，IPv6 字面量
 * 再去掉方括号，和 Go 侧的输出对齐。
 */
function comparableHost(value: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return (bracketed[1] as string).toLowerCase();
  // 只有恰好一个冒号才当作 host:port —— 裸 IPv6（`::1`）有多个冒号，
  // Go 的 SplitHostPort 也解不开它，两边都原样保留
  const single = /^([^:]+):\d+$/.exec(value);
  return (single ? (single[1] as string) : value).toLowerCase();
}

export class SiweMessageRejected extends Error {
  constructor(reason: string) {
    super(`sign-in message rejected: ${reason}`);
    this.name = "SiweMessageRejected";
  }
}

const FIELD = /^([A-Za-z ]+):\s*(.*)$/;

/**
 * 解析 EIP-4361 消息的头两行与字段区。
 * 解析不出必需部分时返回 null —— 调用方按"不可签"处理，而不是猜。
 */
export function parseSiweMessage(message: string): SiweFields | null {
  const lines = message.split("\n");
  const header = lines[0] ?? "";
  const match =
    /^(?<domain>[^\s]+) wants you to sign in with your Ethereum account:$/.exec(
      header,
    );
  const domain = match?.groups?.domain;
  const address = (lines[1] ?? "").trim();
  if (!domain || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(2)) {
    const parsed = FIELD.exec(line.trim());
    if (parsed) fields.set(parsed[1] as string, (parsed[2] as string).trim());
  }
  const chainId = fields.get("Chain ID");
  return {
    domain,
    address,
    uri: fields.get("URI") ?? null,
    chainId: chainId !== undefined && chainId !== "" ? Number(chainId) : null,
    nonce: fields.get("Nonce") ?? null,
    issuedAt: fields.get("Issued At") ?? null,
    expirationTime: fields.get("Expiration Time") ?? null,
  };
}

/**
 * 签之前的最后一道检查。不通过就抛 `SiweMessageRejected`，
 * 登录流程按普通失败展示，不会把签名交出去。
 */
export function assertSiweMessage(
  message: string,
  expected: {
    domain: string;
    address: string;
    nonce: string;
    /** 本次会话批准的链（EIP-155 数字 id）；消息里的链必须在其中 */
    chainIds?: number[];
    nowMs?: number;
  },
): SiweFields {
  const parsed = parseSiweMessage(message);
  if (!parsed) throw new SiweMessageRejected("not a valid EIP-4361 message");
  if (comparableHost(parsed.domain) !== comparableHost(expected.domain))
    throw new SiweMessageRejected(
      `domain ${parsed.domain} is not ${expected.domain}`,
    );
  if (parsed.address.toLowerCase() !== expected.address.toLowerCase())
    throw new SiweMessageRejected(
      `address ${parsed.address} is not the account being signed in`,
    );
  if (parsed.nonce !== expected.nonce)
    throw new SiweMessageRejected("nonce does not match the issued challenge");
  // 消息把登录绑在某条链上。服务端给了一条本次会话没批准的链时，这张凭证
  // 可能是替另一条链换的，不能替它签名（安全评审 N26）。
  if (
    expected.chainIds !== undefined &&
    parsed.chainId !== null &&
    !expected.chainIds.includes(parsed.chainId)
  )
    throw new SiweMessageRejected(
      `chain ${parsed.chainId} is not one of the chains this session approved`,
    );
  if (parsed.expirationTime !== null) {
    const expiresAt = Date.parse(parsed.expirationTime);
    if (Number.isNaN(expiresAt))
      throw new SiweMessageRejected("expiration time is not a valid timestamp");
    if (expiresAt <= (expected.nowMs ?? Date.now()))
      throw new SiweMessageRejected("message has already expired");
  }
  return parsed;
}
