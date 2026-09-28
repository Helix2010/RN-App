import { spawnSync } from "node:child_process";
import { doctorVerdict } from "./lib/expo-doctor-verdict.js";

const result = spawnSync("pnpm", ["dlx", "expo-doctor"], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

// 放行哪些失败、为什么（补丁级落后、Linux 上没有 CocoaPods）见 lib/expo-doctor-verdict.js
const verdict = doctorVerdict(output, result.status, process.platform);
for (const warning of verdict.warnings) console.warn(warning);
process.exit(verdict.pass ? 0 : (result.status ?? 1));
