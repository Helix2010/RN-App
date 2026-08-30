import {
  CHAINS,
  memoryStorage,
  nextId,
  type Chain,
  type ChainId,
  type KeyValueStorage,
  type TokenRef,
  type Tx,
} from "../../../core/gateways/types";
import {
  mockNowIso,
  mockRandom,
  simulate,
} from "../../../core/mock/mock-runtime";
import {
  add,
  fromDecimal,
  isNegative,
  money,
  sub,
  toApproxNumber,
  type Money,
} from "../../../core/money/money";
import type { WalletConnectorId } from "../../session/model/session";
import {
  CONNECTORS,
  EMBEDDED_ADDRESS,
  EXTERNAL_ADDRESS,
  REFERENCE_PRICES_USD,
  TOKENS,
  tokenKey,
} from "../fixtures/wallet";
import type {
  SendRequest,
  TokenBalance,
  WalletAccount,
  WalletConnector,
  WalletTransfer,
} from "../model/wallet";
import type { WalletGateway } from "./gateway";

type State = {
  accounts: WalletAccount[];
  /** address -> tokenKey -> raw */
  balances: Record<string, Record<string, string>>;
  transfers: WalletTransfer[];
};

const KEY = "foundation.mock-state.wallet.v1";

function seedBalances(address: string): Record<string, string> {
  if (address === EXTERNAL_ADDRESS) {
    return {
      BNB: fromDecimal("0.842", 18, "BNB").raw,
      "USDT.bsc": fromDecimal("8120", 18, "USDT").raw,
      "USDC.bsc": fromDecimal("3000", 18, "USDC").raw,
      PEPE: fromDecimal("8118902", 18, "PEPE").raw,
      ETH: fromDecimal("0.12", 18, "ETH").raw,
      AERO: fromDecimal("120", 18, "AERO").raw,
    };
  }
  return {
    BNB: fromDecimal("0.05", 18, "BNB").raw,
    "USDT.bsc": fromDecimal("250", 18, "USDT").raw,
  };
}

export class MockWalletGateway implements WalletGateway {
  private state: State | null = null;
  private loading: Promise<State> | null = null;
  /** 注入：下一次签名 / 交易的结果，用于演示拒绝与超时 */
  nextSignatureOutcome: "ok" | "rejected" | "timeout" = "ok";

  constructor(private readonly storage: KeyValueStorage = memoryStorage()) {}

  private async load(): Promise<State> {
    if (this.state) return this.state;
    if (!this.loading) {
      this.loading = (async () => {
        const raw = await this.storage.getItem(KEY);
        if (raw) {
          try {
            this.state = JSON.parse(raw) as State;
            return this.state;
          } catch {
            /* fallthrough */
          }
        }
        this.state = { accounts: [], balances: {}, transfers: [] };
        return this.state;
      })();
    }
    return this.loading;
  }

  private async save(): Promise<void> {
    if (this.state) await this.storage.setItem(KEY, JSON.stringify(this.state));
  }

  async listChains(): Promise<Chain[]> {
    return Object.values(CHAINS);
  }

  async listConnectors(): Promise<WalletConnector[]> {
    return simulate(() => CONNECTORS);
  }

  async listAccounts(): Promise<WalletAccount[]> {
    const state = await this.load();
    return state.accounts;
  }

  async currentAccount(): Promise<WalletAccount | null> {
    const state = await this.load();
    return state.accounts.find((account) => account.current) ?? null;
  }

  async connect(connector: WalletConnectorId): Promise<WalletAccount> {
    return simulate(async () => {
      const state = await this.load();
      const address =
        connector === "embedded" ? EMBEDDED_ADDRESS : EXTERNAL_ADDRESS;
      let account = state.accounts.find((item) => item.address === address);
      if (!account) {
        account = {
          address,
          label: connector === "embedded" ? "主钱包" : "kenneth.eth",
          connector,
          chains: ["bsc", "eth", "base"],
          current: false,
          backedUp: connector !== "embedded",
        };
        state.accounts.push(account);
        state.balances[address] = seedBalances(address);
      }
      state.accounts.forEach((item) => {
        item.current = item.address === address;
      });
      await this.save();
      return account;
    });
  }

  async disconnect(address: string): Promise<void> {
    const state = await this.load();
    const wasCurrent = state.accounts.find(
      (item) => item.address === address,
    )?.current;
    state.accounts = state.accounts.filter((item) => item.address !== address);
    if (wasCurrent && state.accounts[0]) state.accounts[0].current = true;
    await this.save();
  }

  async switchAccount(address: string): Promise<WalletAccount> {
    const state = await this.load();
    const target = state.accounts.find((item) => item.address === address);
    if (!target) throw new Error("account not found");
    state.accounts.forEach((item) => {
      item.current = item.address === address;
    });
    await this.save();
    return target;
  }

  async markBackedUp(address: string): Promise<void> {
    const state = await this.load();
    const target = state.accounts.find((item) => item.address === address);
    if (target) target.backedUp = true;
    await this.save();
  }

  async getBalances(address: string, chain?: ChainId): Promise<TokenBalance[]> {
    return simulate(async () => {
      const state = await this.load();
      const ledger = state.balances[address] ?? {};
      return Object.entries(ledger)
        .map(([key, raw]) => {
          const token = TOKENS[key];
          if (!token) return null;
          if (chain && token.chain !== chain) return null;
          const amount = money(raw, token.decimals, token.symbol);
          const price = REFERENCE_PRICES_USD[key] ?? 0;
          return {
            token,
            amount,
            usdValue: toApproxNumber(amount) * price,
            change24hPct: mockChange(key),
          } satisfies TokenBalance;
        })
        .filter((item): item is TokenBalance => item !== null)
        .sort((a, b) => b.usdValue - a.usdValue);
    });
  }

  async adjustBalance(
    address: string,
    token: TokenRef,
    delta: Money,
  ): Promise<void> {
    const state = await this.load();
    const key = tokenKey(token);
    const ledger = (state.balances[address] ??= {});
    const current = money(ledger[key] ?? "0", token.decimals, token.symbol);
    const next = add(current, money(delta.raw, token.decimals, token.symbol));
    if (isNegative(next)) throw new Error("insufficient balance");
    ledger[key] = next.raw;
    await this.save();
  }

  async signMessage(address: string, message: string): Promise<string> {
    return simulate(async () => {
      const outcome = this.nextSignatureOutcome;
      this.nextSignatureOutcome = "ok";
      if (outcome === "rejected") throw new Error("user rejected");
      if (outcome === "timeout") throw new Error("wallet timeout");
      const digest = Array.from(`${address}:${message}`).reduce(
        (acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0,
        7,
      );
      return `0x${digest.toString(16).padStart(8, "0")}${"ab".repeat(60)}`;
    });
  }

  async send(request: SendRequest): Promise<WalletTransfer> {
    return simulate(async () => {
      const state = await this.load();
      const key = tokenKey(request.token);
      const ledger = (state.balances[request.from] ??= {});
      const current = money(
        ledger[key] ?? "0",
        request.token.decimals,
        request.token.symbol,
      );
      const next = sub(current, request.amount);
      if (isNegative(next)) throw new Error("insufficient balance");
      ledger[key] = next.raw;
      const transfer: WalletTransfer = {
        id: nextId("tx"),
        kind: "send",
        status: "submitted",
        token: request.token,
        amount: request.amount,
        counterparty: request.to,
        updatedAt: mockNowIso(),
        hash: `0x${Math.floor(mockRandom() * 1e16)
          .toString(16)
          .padStart(16, "0")}${"0".repeat(48)}`,
      };
      state.transfers.unshift(transfer);
      await this.save();
      // 状态机推进：submitted → confirming → confirmed
      setTimeout(() => void this.advance(transfer.id, "confirming"), 1_500);
      setTimeout(() => void this.advance(transfer.id, "confirmed"), 4_000);
      return transfer;
    });
  }

  private async advance(id: string, status: Tx["status"]): Promise<void> {
    const state = await this.load();
    const transfer = state.transfers.find((item) => item.id === id);
    if (
      !transfer ||
      transfer.status === "failed" ||
      transfer.status === "confirmed"
    )
      return;
    transfer.status = status;
    transfer.updatedAt = mockNowIso();
    await this.save();
  }

  async getTransaction(id: string): Promise<Tx | null> {
    const state = await this.load();
    return state.transfers.find((item) => item.id === id) ?? null;
  }

  async listTransfers(address: string): Promise<WalletTransfer[]> {
    const state = await this.load();
    return state.transfers.filter(
      (item) => item.counterparty !== address || item.kind === "receive",
    );
  }
}

function mockChange(key: string): number {
  const table: Record<string, number> = {
    BNB: 1.8,
    PEPE: 12.4,
    ETH: 3.2,
    AERO: 5.1,
    CAKE: 2.2,
    UNI: -0.6,
    MOG: -22,
    ZORA: 186,
  };
  return table[key] ?? 0;
}
