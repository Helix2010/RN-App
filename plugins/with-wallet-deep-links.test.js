/* global describe, it, expect */

const {
  mergeQueries,
  WALLET_PACKAGES,
  WALLET_SCHEMES,
} = require("./with-wallet-deep-links");

function names(queries) {
  return (queries[0].package ?? []).map((item) => item.$["android:name"]);
}

function schemes(queries) {
  return (queries[0].intent ?? [])
    .flatMap((intent) => intent.data ?? [])
    .map((data) => data.$["android:scheme"]);
}

describe("wallet deep link plugin", () => {
  it("declares every wallet package and scheme", () => {
    const result = mergeQueries([]);

    expect(names(result)).toEqual(WALLET_PACKAGES);
    expect(schemes(result)).toEqual(WALLET_SCHEMES);
  });

  it("keeps what Expo already declared", () => {
    // Expo 默认会加一条 https 的 intent，不能被覆盖掉
    const existing = [
      {
        intent: [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            category: [
              { $: { "android:name": "android.intent.category.BROWSABLE" } },
            ],
            data: [{ $: { "android:scheme": "https" } }],
          },
        ],
      },
    ];

    const result = mergeQueries(existing);

    expect(schemes(result)).toContain("https");
    expect(schemes(result)).toContain("metamask");
    expect(schemes(result)).toContain("okx");
  });

  it("is idempotent", () => {
    const once = mergeQueries([]);
    const twice = mergeQueries(once);

    expect(names(twice)).toEqual(WALLET_PACKAGES);
    expect(schemes(twice)).toEqual(WALLET_SCHEMES);
  });
});
