#!/usr/bin/env node
/**
 * 从 src/core/config/fallback-config.ts 的内嵌字典导出 i18n seed JSON：
 *   i18n/seed/zh-CN.json、i18n/seed/en-US.json
 * 供 RN-Server 初始化 language_document（服务端字典 > 内嵌字典 的五级回退保持不变）。
 * 用法：node scripts/export-i18n-seed.mjs [--check]
 *   --check：只校验两张表键集合一致且与已导出文件一致（CI 用）。
 */
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  resolve(root, "src/core/config/fallback-config.ts"),
  "utf8",
);

function table(name) {
  const match = new RegExp(`const ${name}\\b[^=]*=\\s*\\{`).exec(source);
  if (!match) throw new Error(`table ${name} not found`);
  const start = match.index;
  const body = source.slice(start, source.indexOf("\n};", start));
  const entries = {};
  for (const match of body.matchAll(
    /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm,
  )) {
    entries[match[1]] = JSON.parse(`"${match[2]}"`);
  }
  return entries;
}

const zh = table("zhCN");
const en = table("enUS");
const zhKeys = new Set(Object.keys(zh));
const enKeys = new Set(Object.keys(en));
const missingEn = [...zhKeys].filter((key) => !enKeys.has(key));
const missingZh = [...enKeys].filter((key) => !zhKeys.has(key));
if (missingEn.length || missingZh.length) {
  console.error("i18n seed: key sets differ", { missingEn, missingZh });
  process.exit(1);
}

const check = process.argv.includes("--check");

// 校验：代码里静态引用的 t("key") 必须存在于字典（动态前缀 t(`prefix.${x}`) 按前缀放行）
const sourceFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".spec.ts"))
      sourceFiles.push(full);
  }
})(resolve(root, "src"));
const code = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const staticKeys = new Set(
  [...code.matchAll(/\bt\(\s*"([^"]+)"/g)].map((match) => match[1]),
);
const dynamicPrefixes = [...code.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)].map(
  (match) => match[1],
);
const missing = [...staticKeys].filter((key) => !zhKeys.has(key));
if (missing.length) {
  console.error(
    "i18n: keys used in code but missing from fallback dictionary:",
    missing,
  );
  process.exit(1);
}
if (dynamicPrefixes.length && !check) {
  console.log(
    `i18n: ${dynamicPrefixes.length} dynamic key prefixes (not statically verifiable): ${[...new Set(dynamicPrefixes)].join(", ")}`,
  );
}

const outDir = resolve(root, "i18n/seed");
const files = { "zh-CN": zh, "en-US": en };
let changed = false;
for (const [locale, messages] of Object.entries(files)) {
  const sorted = Object.fromEntries(
    Object.keys(messages)
      .sort()
      .map((key) => [key, messages[key]]),
  );
  const payload = `${JSON.stringify({ languageCode: locale, version: "seed", messages: sorted }, null, 2)}\n`;
  const file = resolve(outDir, `${locale}.json`);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current !== payload) {
    changed = true;
    if (!check) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(file, payload);
    }
  }
}
if (check && changed) {
  console.error(
    "i18n seed out of date: run `node scripts/export-i18n-seed.mjs`",
  );
  process.exit(1);
}
console.log(
  `i18n seed: ${zhKeys.size} keys × ${Object.keys(files).length} locales${check ? " (check ok)" : " exported to i18n/seed/"}`,
);
