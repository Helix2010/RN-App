import { applyDeliveredWalletConfig } from "../wallet/config/wallet-runtime-config";
import { tenantWallet } from "../../test/wallet-config";
import {
  PredictPlatformMismatchError,
  assertPublicInfoMatches,
  platformContracts,
  publicInfoSchema,
} from "./public-info";

const SCOPE =
  "0xfb05e4134e5b30db022b94b822e7d19b1e5cd1c244468eada63789fd3514454a";
const service = {
  domain: "predict.prax1s.xyz",
  scopeId: SCOPE,
  chain: "op-sepolia" as const,
};

/** dev 环境 2026-09-02 实测的 public-info（截取需要的字段）。 */
const info = publicInfoSchema.parse({
  scopeId: SCOPE.toUpperCase().replace("0X", "0x"),
  chain: {
    chainId: 11155420,
    name: "OP Sepolia",
    tokens: [
      {
        address: "0x790eabd79898F49859FE283967625438a5856098",
        decimals: 6,
        symbol: "USDW",
      },
      {
        address: "0x2eA619C7CFFFF6C1F1f8800b066D4797E71Bc3AD",
        decimals: 6,
        symbol: "USDC",
      },
    ],
    contracts: [
      {
        name: "USDW_WRAPPER",
        address: "0x7deBd20D92998C32bC3E5028C40635374fB3F740",
      },
      {
        name: "USDC_UNDERLYING",
        address: "0x2eA619C7CFFFF6C1F1f8800b066D4797E71Bc3AD",
      },
      {
        name: "MULTI_SEND_ADDRESS",
        address: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761",
      },
      {
        name: "SAFE_FACTORY_ADDRESS",
        address: "0x08C322E1749062bdf11cdaC5F4BFf44cBB095Fe6",
      },
      {
        name: "NEG_RISK_ADAPTER",
        address: "0x8E0ACbD658fb514C7a919B525f984010eC2c0331",
      },
    ],
  },
  contracts: {
    exchangeAddress: "0xB6C949400E9f20DBf136326e91B3d51aA73F6c2b",
    negRiskExchangeAddress: "0x7dEa4a37b2E2A6f3f1a5170bBc52644C86C7D219",
    ctfAddress: "0x58Ab59C7F83Fb46ffcBF15469404393aE3db12fe",
    collateralToken: "0x790eabd79898F49859FE283967625438a5856098",
  },
  loginStatement:
    "Sign this message to verify your wallet ownership and log in securely.",
});

beforeEach(() =>
  applyDeliveredWalletConfig(tenantWallet({ chains: ["op-sepolia"] })),
);

describe("assertPublicInfoMatches", () => {
  it("accepts the platform when scopeId (case-insensitive) and chainId match", () => {
    expect(() => assertPublicInfoMatches(info, service)).not.toThrow();
  });

  it("refuses another tenant's platform and another chain", () => {
    expect(() =>
      assertPublicInfoMatches(info, {
        ...service,
        scopeId: "0x" + "ab".repeat(32),
      }),
    ).toThrow(PredictPlatformMismatchError);
    applyDeliveredWalletConfig(tenantWallet({ chains: ["eth"] }));
    expect(() =>
      assertPublicInfoMatches(info, { ...service, chain: "eth" }),
    ).toThrow(PredictPlatformMismatchError);
  });
});

describe("platformContracts", () => {
  it("resolves every contract the account slice needs, with token decimals", () => {
    const contracts = platformContracts(info);
    expect(contracts.usdwWrapper).toBe(
      "0x7deBd20D92998C32bC3E5028C40635374fB3F740",
    );
    expect(contracts.usdw).toBe("0x790eabd79898F49859FE283967625438a5856098");
    expect(contracts.usdcDecimals).toBe(6);
    expect(contracts.negRiskExchange).toBe(
      "0x7dEa4a37b2E2A6f3f1a5170bBc52644C86C7D219",
    );
  });

  it("fails loudly when a required contract is missing", () => {
    const without = {
      ...info,
      chain: {
        ...info.chain,
        contracts: info.chain.contracts.filter(
          (c) => c.name !== "MULTI_SEND_ADDRESS",
        ),
      },
    };
    expect(() => platformContracts(without)).toThrow(/MULTI_SEND_ADDRESS/);
  });
});
