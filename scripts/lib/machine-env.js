const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * 机器级构建输入放在 git 忽略的 `.env.local`（或 `.env`）里，命令行不用带环境变量。
 * Expo 自己会读这两个文件生成 app.config；这里把同样的值读给 Gradle 与构建工具那一步。
 *
 * 只读 `keys` 白名单里的键；进程环境里已有的值优先，与 Expo 的加载器一致。
 * 这些文件里不放口令：签名只在签名闸上做，开发自测的测试密钥口令在仓库外的 0600 文件里。
 */
function loadMachineEnv(root, keys, target = process.env) {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || !keys.includes(match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      if (value !== "" && target[match[1]] === undefined)
        target[match[1]] = value;
    }
  }
}

module.exports = { loadMachineEnv };
