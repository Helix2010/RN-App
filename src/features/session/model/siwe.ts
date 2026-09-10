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
  expected: { domain: string; address: string; nonce: string; nowMs?: number },
): SiweFields {
  const parsed = parseSiweMessage(message);
  if (!parsed) throw new SiweMessageRejected("not a valid EIP-4361 message");
  if (parsed.domain !== expected.domain)
    throw new SiweMessageRejected(
      `domain ${parsed.domain} is not ${expected.domain}`,
    );
  if (parsed.address.toLowerCase() !== expected.address.toLowerCase())
    throw new SiweMessageRejected(
      `address ${parsed.address} is not the account being signed in`,
    );
  if (parsed.nonce !== expected.nonce)
    throw new SiweMessageRejected("nonce does not match the issued challenge");
  if (parsed.expirationTime !== null) {
    const expiresAt = Date.parse(parsed.expirationTime);
    if (Number.isNaN(expiresAt))
      throw new SiweMessageRejected("expiration time is not a valid timestamp");
    if (expiresAt <= (expected.nowMs ?? Date.now()))
      throw new SiweMessageRejected("message has already expired");
  }
  return parsed;
}
