import vectors from "../../../contracts/secret-redaction.v1.json";
import { REDACTED, findSecrets, redactSecrets } from "./secret-scan";

/**
 * 出口脱敏的契约向量，和 RN-Server 共享同一份 JSON（`contracts/secret-redaction.v1.json`
 * 与 `RN-Server/contracts/secret-redaction.v1.json` 内容一致）。
 *
 * 诊断上报走两遍脱敏：App 出口一遍，服务端入口再一遍（设计 diagnostic-report-2026-09-14 §3.5）。
 * 两遍规则不一致的后果是服务端的 `redaction_hits` 失去意义——它本该表示"客户端那遍没拦住"，
 * 规则一漂移就变成"两边算法不一样"，红角标从安全信号退化成噪声。
 *
 * 向量以本仓库的 secret-scan.ts 为基准生成；改了扫描规则就必须同时更新两边的这份文件。
 */
describe("secret redaction contract vectors", () => {
  it("agrees with the shared marker and threshold", () => {
    expect(vectors.redacted).toBe(REDACTED);
    expect(vectors.minMnemonicWords).toBe(12);
  });

  it.each(vectors.cases)("$name", ({ input, redacted, kinds }) => {
    expect(redactSecrets(input)).toBe(redacted);
    expect(findSecrets(input).sort()).toEqual(kinds);
  });
});
