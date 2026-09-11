# Feature: Gradle 依赖校验清单（N28，默认关闭的开关）

状态：Done

涉及仓库：RN-App。评审：`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` N28 / §12.2。

## 用户场景与现状证据

- 用户/角色：发版负责人；以及"某个 maven 依赖被顶替了，我们会不会照单全收"这个问题的回答者。
- 当前行为与代码证据：`find . -name verification-metadata.xml` 零命中。JS 侧有 lockfile、有 `pnpm audit`、现在还有 SBOM；**Android 原生依赖这一侧什么都没有**——Gradle 下载到什么就用什么，被顶替的仓库、被改写的本地缓存、下毒的传递依赖都会安静地进 APK。
- 这也是上一批 SBOM 留下的缺口：`rn-app:coverage = javascript-only` 的原因就是"本工程没有 Gradle 依赖锁定，没有权威的原生依赖清单可读"。这一项补的正是那份清单。
- 非目标：把校验默认打开（见下）；PGP 签名校验（`verify-signatures` 保持 false，我们记的是 sha256）。

## Given / When / Then

- Given `GRADLE_DEPENDENCY_VERIFICATION` 没设或为假，When prebuild，Then 清单不安装，且**主动删掉**工程里可能残留的旧清单。
- Given 开关打开且 `gradle/verification-metadata.xml` 在位，When prebuild，Then 清单被装进 `android/gradle/`，Gradle 在下载后、使用前逐个比对 sha256。
- Given 开关打开但清单不存在，Then prebuild 直接失败并告诉你怎么生成——装不上却安静地继续，等于以为开了校验其实没开。
- Given 依赖变了，When 跑开着校验的构建，Then 构建失败（清单里没有那个坐标）；重新生成即可。
- Given 生成清单，Then 走一次真实 release 构建；生成期间校验被强制关掉，否则就是拿旧清单去校验、再用校验失败的结果写新清单。
- Given 生成出来的清单组件数低于 1000，Then 拒绝写出——残缺的清单会被强制执行，然后在别人手里炸成"依赖校验失败"。

## UI 与交互状态

无界面变化。

## 技术影响

- 新增 `gradle/verification-metadata.xml`（1313 个组件，sha256）。`android/` 是 prebuild 生成且不入库的，所以清单存在仓库根的 `gradle/`，由插件装进去。
- 新增 `plugins/with-gradle-dependency-verification.js`：按开关安装或**删除**清单。删除这一半不是顺手写的——Gradle 靠"文件在不在"决定要不要校验，上一次装进去的清单残留下来，会让一个没打算开校验的构建突然开始校验，而且多半是拿一份过期清单。
- `scripts/build-android-release.mjs` 增加 `--write-verification-metadata`（`pnpm android:verification-metadata <slug>`）：真实 release 构建 + `--write-verification-metadata sha256`，完成后带组件数下限地复制回仓库。
  - **用真实构建而不是 `:app:dependencies`**：后者只解析依赖图，取不到 `.aar`，覆盖不到 buildscript 类路径与各个 Expo 子工程。这一点是实测出来的，不是推测——见下。

## 为什么默认关闭

Gradle 的依赖校验没有 lenient 档：文件在就强制执行，清单里少任何一条都让构建失败。而升一个 Expo 小版本、加一个原生模块、甚至 AGP 换个变体都会引入清单里没有的坐标。这条路径是发布门禁——让它在无人预期的时候变红，结果一定是有人为了发版把校验关掉，然后再也不打开。

先用开关在 CI 上跑一段时间，确认"改依赖 → 重新生成"这条流程真的走得通，再把默认改成开。

## 验证与发布

生成与验证都用一次性 keystore（`keytool` 现生成，30 天有效，只为让 Gradle 求值通过），**不碰生产签名材料**；产生的 APK 当场删除，且身份门禁本来就会拒绝它。

- **passed** — 生成：真实 `assembleRelease` 写出 1309 个组件；文件里 0 处机器路径、0 处密钥痕迹。
- **passed** — 装上清单后完整 `assembleRelease` `BUILD SUCCESSFUL`，唯一失败是最后一道身份门禁拒绝一次性签名者（门禁正常工作）。清单是完整可执行的。
- **passed** — 确认 Gradle 真的在读这个文件：把它换成坏 XML，构建硬失败在 `Dependency verification cannot be performed / Unable to read dependency verification metadata`。
- **踩到并记下的坑（两个，第二个改变了实现）**：
  1. 改坏某个 sha256 后跑 `:app:dependencies` **不会**失败。不是校验没生效，是那个任务只打印依赖图、不取 `.aar`，而已解析过的模块元数据走的是 Gradle 的 parsed-metadata 缓存、不会重读原始文件。
  2. **用开发机的暖缓存生成出来的清单是残缺的。** 独立 `GRADLE_USER_HOME` 的冷缓存构建直接失败：`Dependency verification failed for configuration 'classpath' — guava-parent-33.3.1-jre.pom`。同一个原因——生成时那个 POM 在缓存里以"已解析元数据"存在，Gradle 从没读过原始文件，于是没记进清单；而 CI 的 runner 每次都是冷的，必须现取原始 POM。
     **如果按最初的实现合进去，开关一打开 CI 就会挂，而且挂在一个看起来毫无关联的 guava POM 上。**
     修法不是在文档里写一句"记得用干净缓存"——`--write-verification-metadata` 现在自己建一个临时 `GRADLE_USER_HOME`，生成完删掉。代价是重新生成要把依赖整套下一遍（约 1 GB / 十几分钟），但这是个低频操作，而正确性没有折中余地。
- **passed** — 冷缓存重新生成：**1313** 个组件（暖缓存那次 1309，多出来的正是 `guava-parent` 等只在原始文件被读时才会记下的条目）。
- **passed** — 用一个**全新的**冷缓存 + `GRADLE_DEPENDENCY_VERIFICATION=1` 跑真实 `assembleRelease`：`BUILD SUCCESSFUL`，0 条 `Dependency verification failed`。这是这个开关可以在 CI 上打开的凭据。
