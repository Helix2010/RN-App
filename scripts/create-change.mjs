import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [type, rawName] = process.argv.slice(2);
const allowed = new Set(["feature", "bugfix"]);
if (!allowed.has(type) || !rawName) {
  console.error("Usage: pnpm workflow:new <feature|bugfix> <short-name>");
  process.exit(1);
}

const slug = rawName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
  .replace(/^-|-$/g, "");
const date = new Date().toISOString().slice(0, 10);
const directory = resolve(process.cwd(), "docs/changes");
const output = resolve(directory, `${date}-${type}-${slug}.md`);
if (existsSync(output)) {
  console.error(`Change spec already exists: ${output}`);
  process.exit(1);
}

mkdirSync(directory, { recursive: true });
const template = `# ${type === "feature" ? "Feature" : "Bugfix"}: ${rawName}

状态：Draft

## 用户场景与现状证据

- 用户/角色：
- 当前行为或复现：
- 代码调用链：
- 非目标：

## Given / When / Then

1. Given ... When ... Then ...

## UI 与交互状态

- loading / empty / content：
- error / timeout / offline：
- 重复提交 / 取消 / 返回：
- light / dark / 字体放大 / 无障碍：

## 技术影响

- API/OpenAPI：
- 状态与本地数据：
- 钱包/签名/链/金额精度：
- 权限、隐私与遥测：
- OTA 或全量更新：

## 验证与发布

- 修复前失败测试或需求测试：
- iOS / Android：
- 灰度指标与停止条件：
- 回滚：
`;
writeFileSync(output, template, "utf8");
console.log(output);
