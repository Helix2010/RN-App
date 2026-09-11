import { memoryStorage } from "../gateways/types";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import {
  PredictPlatformContractsChangedError,
  assertPinnedPlatformContracts,
  contractPinDiff,
  contractPinKey,
  contractPinRecord,
} from "./contract-pin";
import type { PlatformContracts } from "./public-info";

const SERVICE: PredictServiceConfig = {
  domain: "gamma.example",
  scopeId: `0x${"a".repeat(64)}`,
  chain: "bsc",
};

function contracts(overrides: Partial<PlatformContracts> = {}) {
  return {
    usdw: "0x1111111111111111111111111111111111111111",
    usdcUnderlying: "0x2222222222222222222222222222222222222222",
    usdwWrapper: "0x3333333333333333333333333333333333333333",
    multiSend: "0x4444444444444444444444444444444444444444",
    safeFactory: "0x5555555555555555555555555555555555555555",
    ctf: "0x6666666666666666666666666666666666666666",
    ctfExchange: "0x7777777777777777777777777777777777777777",
    negRiskAdapter: "0x8888888888888888888888888888888888888888",
    negRiskExchange: "0x9999999999999999999999999999999999999999",
    usdwDecimals: 6,
    usdcDecimals: 18,
    umaAdapter: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...overrides,
  } as PlatformContracts;
}

describe("platform contract pin", () => {
  it("pins the first set it sees and accepts it again unchanged", async () => {
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());
    await expect(
      assertPinnedPlatformContracts(storage, SERVICE, contracts()),
    ).resolves.toBeUndefined();
    expect(await storage.getItem(contractPinKey(SERVICE))).toContain("usdw");
  });

  it("refuses a swapped collateral token and names what changed", async () => {
    // 这就是 N3 的资金路径：换掉 collateralToken，开通流程会对它无限额授权
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());

    const swapped = contracts({
      usdw: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
    });
    await expect(
      assertPinnedPlatformContracts(storage, SERVICE, swapped),
    ).rejects.toBeInstanceOf(PredictPlatformContractsChangedError);
    await expect(
      assertPinnedPlatformContracts(storage, SERVICE, swapped),
    ).rejects.toMatchObject({ changed: ["usdw"] });
  });

  it("refuses a swapped exchange even though the collateral is unchanged", async () => {
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());
    await expect(
      assertPinnedPlatformContracts(
        storage,
        SERVICE,
        contracts({
          ctfExchange: "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
        }),
      ),
    ).rejects.toMatchObject({ changed: ["ctfExchange"] });
  });

  it("treats a changed decimals as a change: the same number becomes a different amount", async () => {
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());
    await expect(
      assertPinnedPlatformContracts(
        storage,
        SERVICE,
        contracts({ usdwDecimals: 18 }),
      ),
    ).rejects.toMatchObject({ changed: ["usdwDecimals"] });
  });

  it("notices an optional adapter disappearing", async () => {
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());
    await expect(
      assertPinnedPlatformContracts(
        storage,
        SERVICE,
        contracts({ umaAdapter: undefined }),
      ),
    ).rejects.toMatchObject({ changed: ["umaAdapter"] });
  });

  it("does not trip on a checksum-case change alone", async () => {
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());
    await expect(
      assertPinnedPlatformContracts(
        storage,
        SERVICE,
        contracts({
          usdw: "0x1111111111111111111111111111111111111111"
            .toUpperCase()
            .replace("0X", "0x"),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("keys the pin per domain, scope and chain", async () => {
    const storage = memoryStorage();
    await assertPinnedPlatformContracts(storage, SERVICE, contracts());
    // 另一条链是另一组合约，不该被上一组的记录挡住
    await expect(
      assertPinnedPlatformContracts(
        storage,
        { ...SERVICE, chain: "base" },
        contracts({ usdw: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("re-pins instead of locking the user out when the stored record is corrupt", async () => {
    const storage = memoryStorage();
    await storage.setItem(contractPinKey(SERVICE), "{not json");
    await expect(
      assertPinnedPlatformContracts(storage, SERVICE, contracts()),
    ).resolves.toBeUndefined();
    // 重新钉住之后这条防线照常生效
    await expect(
      assertPinnedPlatformContracts(
        storage,
        SERVICE,
        contracts({ usdw: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead" }),
      ),
    ).rejects.toBeInstanceOf(PredictPlatformContractsChangedError);
  });

  it("diffs by field name so the error says which contract moved", () => {
    const before = contractPinRecord(contracts());
    const after = contractPinRecord(
      contracts({
        ctf: "0xcccccccccccccccccccccccccccccccccccccccc",
        safeFactory: "0xffffffffffffffffffffffffffffffffffffffff",
      }),
    );
    expect(contractPinDiff(before, after)).toEqual(["ctf", "safeFactory"]);
  });
});
