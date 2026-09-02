import { Wallet, getAddress, verifyTypedData } from "ethers";
import { memoryStorage } from "../../../core/gateways/types";
import { fromDecimal } from "../../../core/money/money";
import {
  PredictServiceNotConfiguredError,
  applyDeliveredServices,
} from "../../../core/predict-platform/config";
import {
  conditionalTokens,
  erc20,
  usdWrapper,
} from "../../../core/predict-platform/contracts";
import { PredictCredentialStore } from "../../../core/predict-platform/credentials";
import { safeTxTypedData } from "../../../core/predict-platform/safe";
import { setPlatformFetch } from "../../../core/predict-platform/tenant-client";
import { memorySecureStore } from "../../../core/wallet/vault/ports";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { OnchainTransfers } from "../../wallet/api/onchain-transfers";
import { enablementComplete } from "./account-gateway";
import { HttpPredictAccountGateway } from "./http-predict-account-gateway";

const DOMAIN = "predict.prax1s.xyz";
const SCOPE =
  "0xfb05e4134e5b30db022b94b822e7d19b1e5cd1c244468eada63789fd3514454a";
const CHAIN_ID = 11155420;
const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const USDW = addr(0x1001);
const USDC = addr(0x1002);
const WRAPPER = addr(0x1003);
const MULTI_SEND = addr(0x1004);
const FACTORY = addr(0x1005);
const CTF = addr(0x1006);
const EXCHANGE = addr(0x1007);
const NEG_RISK_ADAPTER = addr(0x1008);
const NEG_RISK_EXCHANGE = addr(0x1009);
const SAFE = addr(0x2001);
const NOW_SECONDS = 1_800_000_000;

const service = {
  domain: DOMAIN,
  scopeId: SCOPE,
  chain: "op-sepolia" as const,
};
const uint = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const selector = (fn: { selector: string } | null) => {
  if (!fn) throw new Error("unknown ABI function");
  return fn.selector;
};

function jwtFor(address: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    sub: address.toLowerCase(),
    scope_id: SCOPE,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 30 * 86_400,
  })}.sig`;
}

function publicInfo() {
  return {
    scopeId: SCOPE,
    chain: {
      chainId: CHAIN_ID,
      name: "OP Sepolia",
      tokens: [
        { address: USDW, symbol: "USDW", decimals: 6 },
        { address: USDC, symbol: "USDC", decimals: 6 },
      ],
      contracts: [
        { name: "USDC_UNDERLYING", address: USDC },
        { name: "USDW_WRAPPER", address: WRAPPER },
        { name: "MULTI_SEND_ADDRESS", address: MULTI_SEND },
        { name: "SAFE_FACTORY_ADDRESS", address: FACTORY },
        { name: "NEG_RISK_ADAPTER", address: NEG_RISK_ADAPTER },
      ],
    },
    contracts: {
      exchangeAddress: EXCHANGE,
      negRiskExchangeAddress: NEG_RISK_EXCHANGE,
      ctfAddress: CTF,
      collateralToken: USDW,
    },
    loginStatement: "Sign in to Predict",
  };
}

type Request = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

/** 平台六个服务的最小假实现：按路径应答，记录每个请求。 */
function platform() {
  const state = {
    safeDeployed: false,
    approved: false,
    submissions: [] as Record<string, unknown>[],
    requests: [] as Request[],
    unwraps: [] as Record<string, unknown>[],
    deriveKeyOk: false,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  setPlatformFetch(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ url, method, headers, body });
    const host = url.host.split(".")[0];
    const path = url.pathname;
    if (host === "gamma-api") {
      if (path === "/public-info") return json(200, publicInfo());
      if (path === "/auth/nonce")
        return json(200, {
          nonce: "73ddbcae74d82e87f8a26cab",
          scopeId: SCOPE,
          issuedAt: new Date(NOW_SECONDS * 1000).toISOString(),
          chainId: CHAIN_ID,
          statement: "Sign in to Predict",
        });
      if (path === "/auth/login")
        return json(200, { token: jwtFor(body.messageParams.address) });
    }
    if (host === "relayer") {
      if (path === "/deployed")
        return json(200, { deployed: state.safeDeployed, address: SAFE });
      if (path === "/nonce") return json(200, { nonce: "0" });
      if (path === "/submit") {
        state.submissions.push(body);
        if (body.type === "SAFE-CREATE") state.safeDeployed = true;
        if (body.metadata === "approval") state.approved = true;
        const id = `tx-${state.submissions.length}`;
        return json(200, {
          transactionID: id,
          transactionHash: `0x${state.submissions.length.toString(16).padStart(64, "0")}`,
          state: "STATE_NEW",
        });
      }
      if (path === "/transaction") {
        const id = url.searchParams.get("id") ?? "";
        const index = Number(id.replace("tx-", ""));
        return json(200, {
          transactionID: id,
          transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
          state: "STATE_MINED",
        });
      }
    }
    if (host === "clob-api") {
      if (path === "/time") return json(200, NOW_SECONDS);
      if (path === "/auth/derive-api-key")
        return state.deriveKeyOk
          ? json(200, { apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" })
          : json(404, { error: "api key not found" });
      if (path === "/auth/api-key") {
        state.deriveKeyOk = true;
        return json(200, {
          apiKey: "key",
          secret: "c2VjcmV0",
          passphrase: "pass",
        });
      }
      if (path === "/balance-allowance")
        return json(200, {
          balance: "1000000",
          virtual_available: "800000",
          locked: "200000",
        });
    }
    if (host === "data-api" && path === "/unwrap-requests")
      return json(200, { data: state.unwraps });
    return json(404, { error: `no route for ${method} ${url.href}` });
  });
  return state;
}

/** 链的假实现：只读调用按选择器应答，写调用只记录。 */
function chain(platformState: ReturnType<typeof platform>) {
  const calls: { to: string; data: string; from: string }[] = [];
  const logs: { address: string; topics: string[]; data: string }[] = [];
  const onchain = {
    async readContract(_chain: string, _to: string, data: string) {
      const sel = data.slice(0, 10);
      if (sel === selector(erc20.getFunction("allowance")))
        return uint(platformState.approved ? (1n << 256n) - 1n : 0n);
      if (sel === selector(conditionalTokens.getFunction("isApprovedForAll")))
        return uint(platformState.approved ? 1n : 0n);
      if (sel === selector(erc20.getFunction("balanceOf")))
        return uint(1_000_000n);
      if (sel === selector(usdWrapper.getFunction("unwrapDelay")))
        return uint(60n);
      if (sel === selector(usdWrapper.getFunction("minUnwrapUsdw")))
        return uint(1000n);
      throw new Error(`unexpected read ${sel}`);
    },
    async tokenBalances() {
      return new Map([
        [USDC.toLowerCase(), 250_000_000n],
        [USDW.toLowerCase(), 5_000_000n],
      ]);
    },
    async nativeBalance() {
      return 10n ** 16n;
    },
    async estimateCall() {
      return 21_000n * 1_000_000_000n;
    },
    async callContract(
      _chain: string,
      call: { to: string; data: string; from: string },
    ) {
      calls.push(call);
      return { hash: `0xc${calls.length.toString(16).padStart(63, "0")}` };
    },
    async receiptOf() {
      return { status: "success" as const, blockNumber: 1 };
    },
    async receiptLogs() {
      return logs;
    },
  };
  return { onchain: onchain as unknown as OnchainTransfers, calls, logs };
}

function signerFor(wallet: Wallet): WalletSigner {
  return {
    address: wallet.address,
    managesOwnFees: false,
    signMessage: (message) => wallet.signMessage(message),
    signTypedData: (domain, types, value) =>
      wallet.signTypedData(domain, types, value),
    submitTransaction: async () => {
      throw new Error("not used");
    },
  };
}

function build(options: { now?: () => number } = {}) {
  const platformState = platform();
  const wallet = new Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  const link = chain(platformState);
  const secure = memorySecureStore();
  const credentials = new PredictCredentialStore(secure);
  const gateway = new HttpPredictAccountGateway({
    wallet: {
      signerFor: async () => signerFor(wallet),
    } as unknown as WalletGateway,
    onchain: link.onchain,
    credentials,
    storage: memoryStorage(),
    now: options.now ?? (() => NOW_SECONDS * 1000),
    sleep: async () => {},
  });
  applyDeliveredServices({ predict: service });
  return { gateway, wallet, platformState, link, credentials };
}

afterEach(() => setPlatformFetch(null));

describe("HttpPredictAccountGateway", () => {
  it("reports not configured without a delivered platform link, without touching the network", async () => {
    const platformState = platform();
    const gateway = new HttpPredictAccountGateway({
      wallet: {} as WalletGateway,
      onchain: {} as OnchainTransfers,
      credentials: new PredictCredentialStore(memorySecureStore()),
      storage: memoryStorage(),
    });
    const status = await gateway.enablement(addr(1));
    expect(status.configured).toBe(false);
    expect(platformState.requests).toEqual([]);
    // 没有关联就没有平台：不是"未启用"，是"没配置"，两者界面上都不能拿演示数据顶
    await expect(gateway.getBalance(addr(1))).rejects.toBeInstanceOf(
      PredictServiceNotConfiguredError,
    );
  });

  it("enables an address: login, Safe deploy, CLOB key, approvals — every call carries the tenant header", async () => {
    const { gateway, wallet, platformState, credentials } = build();
    const steps: string[] = [];
    const status = await gateway.enable(wallet.address, (step) =>
      steps.push(step),
    );
    expect(steps).toEqual(["login", "deploySafe", "clobKey", "approve"]);
    expect(enablementComplete(status)).toBe(true);
    expect(status.safe).toEqual({ address: SAFE, deployed: true });

    // 三笔 relayer 提交：建 Safe、授权 MultiSend
    const [create, approval] = platformState.submissions;
    expect(create?.type).toBe("SAFE-CREATE");
    expect(create?.to).toBe(FACTORY);
    expect(approval?.type).toBe("SAFE");
    expect(approval?.metadata).toBe("approval");
    expect(approval?.to).toBe(MULTI_SEND);
    expect(
      (approval?.signatureParams as Record<string, string>).operation,
    ).toBe("1");
    // 授权签名能用 SafeTx 的 typed data 还原成钱包地址
    const typed = safeTxTypedData(CHAIN_ID, SAFE, {
      to: MULTI_SEND,
      data: approval?.data as string,
      operation: 1,
      nonce: 0n,
    });
    expect(
      verifyTypedData(
        typed.domain,
        typed.types,
        typed.value,
        approval?.signature as string,
      ),
    ).toBe(wallet.address);

    for (const request of platformState.requests)
      expect(request.headers["X-Tenant-Domain"]).toBe(DOMAIN);
    // derive 先试、失败后 create
    const clobPaths = platformState.requests
      .filter((request) => request.url.host.startsWith("clob-api"))
      .map((request) => request.url.pathname);
    expect(clobPaths).toEqual(
      expect.arrayContaining(["/auth/derive-api-key", "/auth/api-key"]),
    );
    const stored = await credentials.load(service, wallet.address);
    expect(stored.jwt).toBeDefined();
    expect(stored.clob?.apiKey).toBe("key");
    expect(stored.safe).toBe(SAFE);

    // 再跑一次什么都不重复
    const before = platformState.submissions.length;
    await gateway.enable(wallet.address);
    expect(platformState.submissions.length).toBe(before);
  });

  it("reads the balance from the Safe and the CLOB once enabled", async () => {
    const { gateway, wallet } = build();
    await gateway.enable(wallet.address);
    const balance = await gateway.getBalance(wallet.address);
    expect(balance).toEqual({
      chain: "op-sepolia",
      safe: SAFE,
      safeBalance: fromDecimal("1", 6, "USDW"),
      available: fromDecimal("0.8", 6, "USDW"),
      lockedInOrders: fromDecimal("0.2", 6, "USDW"),
    });
    const funds = await gateway.walletFunds(wallet.address);
    expect(funds.usdc).toEqual(fromDecimal("250", 6, "USDC"));
    expect(funds.usdw).toEqual(fromDecimal("5", 6, "USDW"));
    expect(funds.native.symbol).toBe("ETH");
    expect(await gateway.unwrapTerms()).toEqual({
      delaySeconds: 60,
      minAmount: fromDecimal("0.001", 6, "USDW"),
    });
  });

  it("deposits USDC with an exact-amount approve followed by wrap into the Safe, paid by the EOA", async () => {
    const { gateway, wallet, link } = build();
    await gateway.enable(wallet.address);
    const steps: string[] = [];
    const tx = await gateway.deposit(
      wallet.address,
      { asset: "USDC", amount: fromDecimal("100", 6, "USDC") },
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["approve", "wrap"]);
    expect(link.calls.map((call) => call.to)).toEqual([USDC, WRAPPER]);
    const approve = erc20.decodeFunctionData(
      "approve",
      link.calls[0]?.data ?? "",
    );
    expect(approve[0]).toBe(WRAPPER);
    expect(approve[1]).toBe(100_000_000n);
    const wrap = usdWrapper.decodeFunctionData(
      "wrap",
      link.calls[1]?.data ?? "",
    );
    expect(wrap[0]).toBe(USDC);
    expect(wrap[1]).toBe(100_000_000n);
    expect(wrap[2]).toBe(SAFE);
    expect(link.calls.every((call) => call.from === wallet.address)).toBe(true);
    expect(tx.status).toBe("submitted");
    expect((await gateway.getTx(tx.id))?.status).toBe("confirmed");

    // USDW 直接一笔 transfer 到 Safe
    link.calls.length = 0;
    await gateway.deposit(wallet.address, {
      asset: "USDW",
      amount: fromDecimal("3", 6, "USDW"),
    });
    expect(link.calls.map((call) => call.to)).toEqual([USDW]);
    const transfer = erc20.decodeFunctionData(
      "transfer",
      link.calls[0]?.data ?? "",
    );
    expect(transfer[0]).toBe(SAFE);
    expect(transfer[1]).toBe(3_000_000n);
    const quote = await gateway.quoteDeposit(wallet.address, {
      asset: "USDC",
      amount: fromDecimal("1", 6, "USDC"),
    });
    // approve 的费用 × 两步
    expect(BigInt(quote.raw)).toBe(2n * 21_000n * 1_000_000_000n);
  });

  it("withdraws in two phases: initiate-unwrap now, claim to the EOA once the delay has passed", async () => {
    let nowMs = NOW_SECONDS * 1000;
    const { gateway, wallet, link, platformState } = build({
      now: () => nowMs,
    });
    await gateway.enable(wallet.address);
    const claimableAt = NOW_SECONDS + 60;
    const event = usdWrapper.encodeEventLog("UnwrapInitiated", [
      SAFE,
      7n,
      USDC,
      15_000_000n,
      15_000_000n,
      BigInt(claimableAt),
    ]);
    link.logs.push({
      address: WRAPPER,
      topics: [...event.topics],
      data: event.data,
    });

    await expect(
      gateway.withdraw(wallet.address, fromDecimal("0.0001", 6, "USDW")),
    ).rejects.toThrow(/below/);

    const pending = await gateway.withdraw(
      wallet.address,
      fromDecimal("15", 6, "USDW"),
    );
    expect(pending.requestId).toBe("7");
    expect(pending.source).toBe("local");
    expect(pending.assetAmount).toEqual(fromDecimal("15", 6, "USDC"));
    expect(new Date(pending.claimableAt).getTime()).toBe(claimableAt * 1000);
    const initiate = platformState.submissions.at(-1);
    expect(initiate?.metadata).toBe("initiate-unwrap");
    expect(initiate?.to).toBe(MULTI_SEND);

    // 子图还没索引：本机记录顶上；索引到了以平台为准
    expect(await gateway.listPendingWithdrawals(wallet.address)).toEqual([
      pending,
    ]);
    platformState.unwraps.push({
      requestId: "7",
      recipient: SAFE,
      asset: USDC,
      usdwAmount: "15000000",
      assetAmount: "15000000",
      claimableAt: String(claimableAt),
      claimed: false,
      initTxHash: pending.initTxHash,
      initTimestamp: String(NOW_SECONDS),
    });
    const listed = await gateway.listPendingWithdrawals(wallet.address);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.source).toBe("platform");

    await expect(gateway.claimWithdrawal(wallet.address, "7")).rejects.toThrow(
      /not claimable/,
    );
    nowMs = (claimableAt + 1) * 1000;
    const tx = await gateway.claimWithdrawal(wallet.address, "7");
    expect(tx.status).toBe("confirmed");
    const claim = platformState.submissions.at(-1);
    expect(claim?.metadata).toBe("claim-unwrap");
    // MultiSend 里第二段是 USDC.transfer(EOA, assetAmount)
    const transferData = erc20.encodeFunctionData("transfer", [
      wallet.address,
      15_000_000n,
    ]);
    expect(String(claim?.data)).toContain(transferData.slice(2));
  });

  it("throws away every credential when the delivered platform link changes", async () => {
    const { gateway, wallet, credentials } = build();
    await gateway.enable(wallet.address);
    expect((await credentials.load(service, wallet.address)).jwt).toBeDefined();
    applyDeliveredServices({
      predict: { ...service, scopeId: `0x${"ab".repeat(32)}` },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await credentials.load(service, wallet.address)).toEqual({});
    // 新关联与平台 public-info 的 scopeId 对不上：任何需要平台的调用都被拒绝，不降级
    await expect(gateway.enablement(wallet.address)).rejects.toThrow(/scopeId/);
    await expect(gateway.enable(wallet.address)).rejects.toThrow(/scopeId/);
  });
});
