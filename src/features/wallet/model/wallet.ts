import type { ChainId, TokenRef, Tx } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type { WalletConnectorId } from "../../session/model/session";

export type WalletConnector = {
  id: WalletConnectorId;
  name: string;
  kind: "embedded" | "external";
  /** 租户配了 WalletConnect projectId 才能连；false 时 UI 置灰 */
  configured: boolean;
  /** 这个钱包 App 装在本机没有。false 只改文案：点了走扫码，不禁用 */
  installed: boolean;
  logoColor: string;
};

export type WalletAccount = {
  address: string;
  label: string;
  connector: WalletConnectorId;
  chains: ChainId[];
  current: boolean;
  /** 仅内置钱包有意义；外部钱包视为 true */
  backedUp: boolean;
};

export type TokenBalance = {
  token: TokenRef;
  amount: Money;
  /** 美元估值；没有参考价的币是 null——不显示估值、转出一律要求验证，不能按 0 算 */
  usdValue: number | null;
  change24hPct: number;
};

/**
 * 某条链的余额这次没拿到。它不是 0，也不是演示数字：界面要单独说明这条链不可用，
 * 其他链的真实余额照常显示。
 * - node：节点没有响应 / 返回错误；
 * - endpoints：真链模式下这条链没有可用的 RPC 端点（配置问题）；
 * - catalogue：下发的代币目录缺这条链的原生币条目（数据问题）。
 */
export type ChainBalanceFailure = {
  chain: ChainId;
  reason: "node" | "endpoints" | "catalogue";
};

/** 一次余额查询的结果：拿到的余额 + 没拿到的链。 */
export type BalanceSnapshot = {
  items: TokenBalance[];
  unavailable: ChainBalanceFailure[];
};

export type SendRequest = {
  from: string;
  to: string;
  token: TokenRef;
  amount: Money;
  /** 用户在确认页看到并接受的手续费；真链签名时实际费用不得明显超过它 */
  maxFee?: Money;
};

/**
 * 转出前的链上预估。只有真链能给出，Mock 返回 null——宁可界面上说"暂不可估"，
 * 也不要编一个数字：手续费写错会让用户以为余额够。
 */
export type TransferQuote = {
  /** 这笔转账要付的手续费，以链的原生币计价 */
  fee: Money;
  /** 原生币"全部转出"的上限（已扣手续费）；ERC-20 转账为 null */
  maxAmount: Money | null;
};

export type WalletTransfer = Tx & {
  kind: "send" | "receive";
  token: TokenRef;
  amount: Money;
  counterparty: string;
  /**
   * 只有平台索引（RN-Server 扫链）给出的记录才有：`tx` 已定位到交易；`unattributed`
   * 只有余额差额（合约内部转账或索引中断期间），交易待后台任务定位，此时没有哈希与对手方。
   */
  attribution?: "tx" | "unattributed";
  /** 区块时间戳（ISO）；本机账本的进行中记录没有 */
  blockTime?: string;
};

/** 平台收款索引在某条链上的运行状态，与 RN-Server chain_scan_state.state 一致 */
export type TransferIndexState =
  "idle" | "scanning" | "catching_up" | "stalled" | "paused" | "unconfigured";

export type TransferIndex = {
  state: TransferIndexState;
  /** 已索引到的区块（含）；unconfigured 没有 */
  block?: number;
  headBlock?: number;
  /** 已索引到的区块的链上时间（ISO） */
  time?: string;
  /** now − time；界面超过 600 秒才提示落后 */
  lagSeconds?: number;
};

/**
 * 记录页的数据：服务端索引 ∪ 本机账本（按链 + 哈希去重，服务端为准）。
 * `index` 空对象表示没有索引服务（演示账本或未注入）；`indexError` 表示索引服务这次
 * 没答上——本机记录照常返回，界面必须说明服务端记录可能缺失，不能装作没事。
 */
export type WalletTransferFeed = {
  items: WalletTransfer[];
  index: Partial<Record<ChainId, TransferIndex>>;
  indexError?: string;
  /** 服务端给了但无法显示的记录数（代币不在目录、链不在本构建）；界面要说明 */
  hidden: number;
};
