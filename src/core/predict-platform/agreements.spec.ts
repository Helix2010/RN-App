import { memoryStorage } from "../gateways/types";
import {
  AgreementAcceptanceStore,
  fetchAgreements,
  pendingAgreements,
  pickAgreementText,
  type PlatformAgreement,
} from "./agreements";
import { setPlatformFetch } from "./tenant-client";

const SCOPE = `0x${"fb".repeat(32)}`;
const service = {
  domain: "predict.prax1s.xyz",
  scopeId: SCOPE,
  chain: "op-sepolia" as const,
};

function agreement(over: Partial<PlatformAgreement> = {}): PlatformAgreement {
  return {
    type: "terms",
    titleTranslation: '{"en": "Terms", "zh": "条款"}',
    version: "v1.1",
    contentTranslation: '{"zh":"内容","en":"Content"}',
    required: true,
    sortOrder: 0,
    ...over,
  };
}

afterEach(() => setPlatformFetch(null));

describe("pickAgreementText", () => {
  it("resolves locale keys the way the web client does (zh-CN → zh, en_US → en)", () => {
    const raw = '{"en": "Terms", "zh": "条款"}';
    expect(pickAgreementText(raw, "zh-CN")).toBe("条款");
    expect(pickAgreementText(raw, "en-US")).toBe("Terms");
    expect(pickAgreementText('{"zh_CN": "条款"}', "zh-CN")).toBe("条款");
    expect(pickAgreementText('{"en_US": "Terms"}', "en-US")).toBe("Terms");
  });

  it("falls back to default, then en, then the first non-empty value", () => {
    expect(pickAgreementText('{"default": "D", "fr": "F"}', "zh-CN")).toBe("D");
    expect(pickAgreementText('{"en": "E", "fr": "F"}', "zh-CN")).toBe("E");
    expect(pickAgreementText('{"fr": "F", "de": ""}', "zh-CN")).toBe("F");
    expect(pickAgreementText("{}", "zh-CN")).toBeUndefined();
  });

  it("returns a plain string untouched — externalUrl may be a bare URL", () => {
    expect(pickAgreementText("https://example.com/terms", "zh-CN")).toBe(
      "https://example.com/terms",
    );
    expect(
      pickAgreementText(
        '{"zh":"https://baidu.com?lang=cn","en":"https://baidu.com?lang=en"}',
        "en-US",
      ),
    ).toBe("https://baidu.com?lang=en");
    expect(pickAgreementText(undefined, "zh-CN")).toBeUndefined();
  });
});

describe("pendingAgreements + AgreementAcceptanceStore", () => {
  it("only required agreements whose accepted version differs are pending", async () => {
    const store = new AgreementAcceptanceStore(memoryStorage());
    const list = [
      agreement(),
      agreement({ type: "rules", required: false }),
      agreement({ type: "privacy", version: "v2" }),
    ];
    expect(pendingAgreements(list, await store.load(SCOPE))).toEqual([
      list[0],
      list[2],
    ]);
    await store.accept(SCOPE, [list[0]!, list[2]!]);
    expect(pendingAgreements(list, await store.load(SCOPE))).toEqual([]);
    // 版本升级后重新待接受；另一个 scopeId 互不影响
    const bumped = agreement({ version: "v1.2" });
    expect(pendingAgreements([bumped], await store.load(SCOPE))).toEqual([
      bumped,
    ]);
    expect(
      pendingAgreements(list, await store.load(`0x${"aa".repeat(32)}`)),
    ).toHaveLength(2);
  });
});

describe("fetchAgreements", () => {
  it("reads GET {gamma}/agreements with the tenant header and sorts by sortOrder", async () => {
    let seen: { url: string; header: string | undefined } | null = null;
    setPlatformFetch(async (input, init) => {
      seen = {
        url: String(input),
        header: (init?.headers as Record<string, string>)["X-Tenant-Domain"],
      };
      return new Response(
        JSON.stringify({
          agreements: [
            agreement({ type: "b", sortOrder: 2 }),
            { ...agreement({ type: "a", sortOrder: 1 }), externalUrl: "x" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const list = await fetchAgreements(service);
    expect(list.map((item) => item.type)).toEqual(["a", "b"]);
    expect(seen).toEqual({
      url: "https://gamma-api.predict.prax1s.xyz/agreements",
      header: "predict.prax1s.xyz",
    });
  });
});
