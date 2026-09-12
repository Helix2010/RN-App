import { memoryStorage } from "../../gateways/types";
import { KeystoreVault, WalletAuthRequiredError } from "./keystore-vault";
import { memorySecureStore } from "./ports";

const platform = { allowOverride: true };

jest.mock("./platform-authenticate", () => ({
  platformAuthenticate: jest.fn(async () => "cancelled"),
  authenticateOverrideAllowed: () => platform.allowOverride,
}));

/**
 * 安全评审 N6。
 *
 * `KeystoreVault` 与端口都是导出的，所以同信任域里的任何 JS——一个 OTA 下来的
 * bundle、一个被投毒的依赖——都能拿同一份存储另起一个金库，塞一个恒真的验证器，
 * 零弹窗读出助记词。发布构建里这条路必须是死的。
 *
 * 开关本身在发布包里是**编译期常量**（`__DEV__` 与 `process.env.NODE_ENV` 都会被
 * 打包器折叠成字面量），运行时改环境变量改不动它——所以这里 mock 它所在的模块，
 * 而不是去改 `process.env`。第一版正是改 env，结果测试恒过、什么都没验到。
 */
describe("vault authentication is not an injectable capability", () => {
  afterEach(() => {
    platform.allowOverride = true;
  });

  it("ignores an injected authenticator outside test builds", async () => {
    const storage = memoryStorage();
    const secureStore = memorySecureStore();
    const owner = new KeystoreVault({
      storage,
      secureStore,
      authenticate: async () => "success",
    });
    const { entry } = await owner.createWallet("reason");

    platform.allowOverride = false;
    const attacker = jest.fn(async () => "success" as const);
    const stolen = new KeystoreVault({
      storage,
      secureStore,
      authenticate: attacker,
    });
    // 平台实现被 mock 成"用户取消"，所以真正生效的是它而不是攻击者那个恒真的
    await expect(
      stolen.revealMnemonic(entry.address, "reason"),
    ).rejects.toBeInstanceOf(WalletAuthRequiredError);
    expect(attacker).not.toHaveBeenCalled();
  });

  it("still accepts injection in tests, otherwise none of this is testable", async () => {
    const stub = jest.fn(async () => "success" as const);
    const vault = new KeystoreVault({
      storage: memoryStorage(),
      secureStore: memorySecureStore(),
      authenticate: stub,
    });
    const created = await vault.createWallet("reason");
    expect(created.mnemonic.split(" ")).toHaveLength(24);
  });
});
