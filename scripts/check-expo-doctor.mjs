import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["dlx", "expo-doctor"], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

if (result.status === 0) process.exit(0);

// Ubuntu runners cannot provide CocoaPods. Keep the dependency/config checks
// strict while treating only this host-tooling limitation as informational.
const onlyCocoaPodsFailure =
  /Check native tooling versions[\s\S]*CocoaPods version check failed/.test(
    output,
  ) && (output.match(/✖/g) ?? []).length === 1;
if (onlyCocoaPodsFailure && process.platform === "linux") {
  console.warn(
    "expo-doctor: CocoaPods is unavailable on Linux; native iOS tooling check skipped.",
  );
  process.exit(0);
}
process.exit(result.status ?? 1);
