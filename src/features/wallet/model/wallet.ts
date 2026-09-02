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
};
