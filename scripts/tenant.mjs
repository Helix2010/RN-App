#!/usr/bin/env node
/**
 * 租户工厂：为某个租户准备打包输入（每个租户各自域名、各自包）。
 *   node scripts/tenant.mjs <slug> [--pull-branding] [--env-file]
 * - 读取 tenants/<slug>/tenant.json（应用名 / scheme / 包名 / API 域名 / applicationId / 图标底色）
 * - --pull-branding：GET <apiBaseUrl>/v1/mobile/bootstrap，把租户服务端 branding 的 logo 下载为
 *   assets/tenants/<slug>/icon.png（桌面图标 + Android 自适应前景），并生成纯色背景 PNG（图标底色）
 * - --env-file：只写租户 slug；其他构建字段始终从 tenant.json 读取，避免配置复制与漂移
 * app.config.ts 通过 EXPO_PUBLIC_TENANT=<slug> 读取 tenant.json 生成全部构建配置。
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { readTenantConfig } from "./tenant-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [slug, ...flags] = process.argv.slice(2);
if (!slug) {
  console.error(
    "usage: node scripts/tenant.mjs <slug> [--pull-branding] [--env-file]",
  );
  process.exit(1);
}
const tenantFile = resolve(root, "tenants", slug, "tenant.json");
if (!existsSync(tenantFile)) {
  console.error(`tenant not found: ${tenantFile}`);
  process.exit(1);
}
const tenant = readTenantConfig(slug);
const assetDir = resolve(root, "assets", "tenants", slug);
mkdirSync(assetDir, { recursive: true });

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** 生成纯色 PNG（自适应图标背景）。 */
function solidPng(size, hex) {
  const [r, g, b] = [1, 3, 5].map((index) =>
    parseInt(hex.slice(index, index + 2), 16),
  );
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const name of [
  "icon.png",
  "android-icon-foreground.png",
  "android-icon-background.png",
  "android-icon-monochrome.png",
]) {
  const target = resolve(assetDir, name);
  if (!existsSync(target)) copyFileSync(resolve(root, "assets", name), target);
}

if (flags.includes("--pull-branding")) {
  const url = `${tenant.apiBaseUrl.replace(/\/$/, "")}/v1/mobile/bootstrap?platform=android&locale=en-US`;
  const response = await fetch(url, {
    headers: { "X-Application-Id": tenant.applicationId },
  });
  if (!response.ok) {
    console.error(`bootstrap ${response.status} from ${url}`);
    process.exit(1);
  }
  const payload = await response.json();
  const config = payload.data ?? payload;
  const visuals = config.branding?.launch?.visuals;
  const logo = visuals?.light?.logo ?? visuals?.dark?.logo;
  if (!logo?.fileUrl) {
    console.error("tenant branding has no logo; keep repository default icon");
  } else {
    const logoUrl = /^https?:\/\//i.test(logo.fileUrl)
      ? logo.fileUrl
      : new URL(logo.fileUrl, `${tenant.apiBaseUrl}/`).toString();
    const image = await fetch(logoUrl);
    if (!image.ok) {
      console.error(`logo download failed ${image.status}`);
      process.exit(1);
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    writeFileSync(resolve(assetDir, "icon.png"), bytes);
    writeFileSync(resolve(assetDir, "android-icon-foreground.png"), bytes);
    console.log(
      `logo → assets/tenants/${slug}/icon.png (${bytes.length} bytes, ${logo.assetId ?? "no id"})`,
    );
  }
  writeFileSync(
    resolve(assetDir, "android-icon-background.png"),
    solidPng(1024, tenant.iconBackgroundColor ?? "#FFFFFF"),
  );
  console.log(
    `background → assets/tenants/${slug}/android-icon-background.png (${tenant.iconBackgroundColor ?? "#FFFFFF"})`,
  );
}

if (flags.includes("--env-file")) {
  const env = `EXPO_PUBLIC_TENANT=${slug}\n`;
  writeFileSync(resolve(root, ".env.tenant"), env);
  console.log("wrote .env.tenant");
}

console.log(
  `tenant ${slug}: ${tenant.appName} · ${tenant.androidPackage} · ${tenant.apiBaseUrl}`,
);
console.log(`next: pnpm android:release ${slug}`);
