import { memoryStorage } from "../../gateways/types";
import {
  KeystoreVault,
  WalletPassphraseRequiredError,
  WalletVaultError,
} from "./keystore-vault";
import {
  memorySecureStore,
  type AuthenticatedSecureStorePort,
  type SecureStorePort,
} from "./ports";
import { WalletPassphraseError } from "./passphrase";

/**
 * 口令保护（安全评审 N6 / 方案 §3.5）。这些用例盯的是那条不可逆的边界：
 * 开启之后，那把谁都能读的 WK 必须消失；而 WK 必须仍然有两条独立的取回路径。
 */

const PASSPHRASE = "correct horse battery";

function setup(options?: { authenticatedAvailable?: boolean }) {
  const storage = memoryStorage();
  const inner = memorySecureStore();
  const secureStore: SecureStorePort = {
    get: jest.fn(inner.get),
    set: jest.fn(inner.set),
    remove: jest.fn(inner.remove),
  };
  const authInner = memorySecureStore();
  let available = options?.authenticatedAvailable ?? true;
  let invalidated = false;
  const authenticatedStore: AuthenticatedSecureStorePort = {
    get: jest.fn(async (key: string) => {
      if (invalidated) throw new Error("key permanently invalidated");
      return authInner.get(key);
    }),
    set: jest.fn(authInner.set),
    remove: jest.fn(authInner.remove),
    available: () => available,
  };
  const requestPassphrase = jest.fn(
    async (_purpose: "unlock" | "reveal", _retry: boolean) =>
      PASSPHRASE as string | null,
  );
  const vault = new KeystoreVault({
    storage,
    secureStore,
    authenticate: async () => "success",
    authenticatedStore,
    requestPassphrase,
    now: () => 1_700_000_000_000,
  });
  return {
    vault,
    storage,
    secureStore,
    authenticatedStore,
    requestPassphrase,
    setAvailable: (next: boolean) => {
      available = next;
    },
    /** 模拟"用户新录了一枚指纹"：系统把认证绑定的那把密钥作废了 */
    invalidateAuthenticatedKey: () => {
      invalidated = true;
    },
  };
}

const LEGACY_WK = "foundation.wallet.wrap-key.v1";

describe("开启口令保护", () => {
  it("开启之后那把谁都能读的 WK 消失，两条取回路径都在", async () => {
    const s = setup();
    await s.vault.createWallet();
    expect(await s.secureStore.get(LEGACY_WK)).not.toBeNull();

    await s.vault.enablePassphrase(PASSPHRASE, "security.enable");

    // N6 的整个要点：JS 不能再直接读出包裹密钥
    expect(await s.secureStore.get(LEGACY_WK)).toBeNull();
    expect(await s.vault.isPassphraseProtected()).toBe(true);
    // A 路建起来了，B 路的设备密钥也在
    expect(await s.authenticatedStore.get(LEGACY_WK)).not.toBeNull();
    expect(
      await s.secureStore.get("foundation.wallet.envelope-key.v1"),
    ).not.toBeNull();
  });

  it("开启之后照样能签名，用户感觉不到差别", async () => {
    const s = setup();
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "security.enable");

    const address = await s.vault.withPrivateKey(
      entry.address,
      "wallet.sign",
      (key) => key.slice(0, 2),
    );

    expect(address).toBe("0x");
    // 走的是 A 路，没有问过用户口令
    expect(s.requestPassphrase).not.toHaveBeenCalled();
  });

  it("太短的口令直接拒，不会留下半开的状态", async () => {
    const s = setup();
    await s.vault.createWallet();

    await expect(s.vault.enablePassphrase("short", "r")).rejects.toThrow(
      WalletPassphraseError,
    );

    expect(await s.vault.isPassphraseProtected()).toBe(false);
    expect(await s.secureStore.get(LEGACY_WK)).not.toBeNull();
  });

  it("已经开过就不再开——重开会换掉信封，旧口令的用户当场失去钱包", async () => {
    const s = setup();
    await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");

    await expect(
      s.vault.enablePassphrase("another passphrase", "r"),
    ).rejects.toThrow(WalletVaultError);
  });
});

describe("系统作废了认证绑定的那把密钥", () => {
  // 这正是不能把 A 路当唯一副本的理由：用户新录一枚指纹就会走到这里
  it("退回口令，解得开，并且把 A 路重新建起来", async () => {
    const s = setup();
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");
    s.invalidateAuthenticatedKey();

    const prefix = await s.vault.withPrivateKey(
      entry.address,
      "wallet.sign",
      (key) => key.slice(0, 2),
    );

    expect(prefix).toBe("0x");
    expect(s.requestPassphrase).toHaveBeenCalledWith("unlock", false);
    // 重建过 A 路：这一次之后不该再问口令
    expect(s.authenticatedStore.set).toHaveBeenCalledTimes(2);
  });

  it("设备根本没录入生物识别时，只走口令这条路", async () => {
    const s = setup({ authenticatedAvailable: false });
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");

    await s.vault.withPrivateKey(entry.address, "wallet.sign", () => null);

    expect(s.requestPassphrase).toHaveBeenCalledWith("unlock", false);
  });

  it("用户取消输入口令就是拒绝，不是当成没开口令", async () => {
    const s = setup({ authenticatedAvailable: false });
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");
    s.requestPassphrase.mockResolvedValue(null);

    await expect(
      s.vault.withPrivateKey(entry.address, "wallet.sign", () => null),
    ).rejects.toThrow(WalletPassphraseRequiredError);
  });

  it("口令输错报口令错，用户才知道该重输", async () => {
    const s = setup({ authenticatedAvailable: false });
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");
    s.requestPassphrase.mockResolvedValue("not the passphrase");

    await expect(
      s.vault.withPrivateKey(entry.address, "wallet.sign", () => null),
    ).rejects.toThrow(WalletPassphraseError);
  });
});

describe("口令输错", () => {
  it("再问一次，并告诉界面上一次错了", async () => {
    const s = setup({ authenticatedAvailable: false });
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");
    s.requestPassphrase
      .mockResolvedValueOnce("wrong one")
      .mockResolvedValueOnce(PASSPHRASE);

    await s.vault.withPrivateKey(entry.address, "wallet.sign", () => null);

    expect(s.requestPassphrase).toHaveBeenNthCalledWith(1, "unlock", false);
    // 第二次带上"上次错了"：用户看到的是"口令不对"，不是一个沉默的输入框
    expect(s.requestPassphrase).toHaveBeenNthCalledWith(2, "unlock", true);
  });

  it("连错到上限就放弃本次操作，不无限弹", async () => {
    const s = setup({ authenticatedAvailable: false });
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");
    s.requestPassphrase.mockResolvedValue("wrong one");

    await expect(
      s.vault.withPrivateKey(entry.address, "wallet.sign", () => null),
    ).rejects.toThrow(WalletPassphraseError);
    expect(s.requestPassphrase).toHaveBeenCalledTimes(3);
  });

  // 取消不是"输错了"：不该再追问
  it("中途取消就立刻结束，不再追问", async () => {
    const s = setup({ authenticatedAvailable: false });
    const { entry } = await s.vault.createWallet();
    await s.vault.enablePassphrase(PASSPHRASE, "r");
    s.requestPassphrase
      .mockResolvedValueOnce("wrong one")
      .mockResolvedValueOnce(null);

    await expect(
      s.vault.withPrivateKey(entry.address, "wallet.sign", () => null),
    ).rejects.toThrow(WalletPassphraseRequiredError);
    expect(s.requestPassphrase).toHaveBeenCalledTimes(2);
  });
});
