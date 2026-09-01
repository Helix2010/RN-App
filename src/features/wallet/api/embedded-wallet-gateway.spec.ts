import { verifyMessage } from "ethers";
import { memoryStorage } from "../../../core/gateways/types";
import { deriveAccount } from "../../../core/wallet/keygen/mnemonic";
import { KeystoreVault } from "../../../core/wallet/vault/keystore-vault";
import { memorySecureStore } from "../../../core/wallet/vault/ports";
import { MockWalletGateway } from "./mock-wallet-gateway";
import {
  WalletNotProvisionedError,
  WalletProvisioningUnsupportedError,
} from "./gateway";
import {
  EmbeddedWalletGateway,
  type ExternalWalletConnector,
} from "./embedded-wallet-gateway";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const EXTERNAL = "0x3f4A8C21b7d94E0a1F6c5d2e8b9A7c3D4e5F9a2C";

function setup(options?: { external?: ExternalWalletConnector }) {
  const storage = memoryStorage();
  const vault = new KeystoreVault({
    storage: memoryStorage(),
    secureStore: memorySecureStore(),
    authenticate: async () => "success",
  });
  const chainData = new MockWalletGateway(memoryStorage());
  const seeded: string[] = [];
  const gateway = new EmbeddedWalletGateway({
    vault,
    chainData,
    storage,
    external: options?.external,
    seedDemoBalances: async (address) => {
      seeded.push(address);
    },
  });
  return { gateway, vault, chainData, seeded };
}

function fakeExternal(): ExternalWalletConnector {
  return {
    connect: jest.fn(async () => ({
      address: EXTERNAL,
      chains: ["bsc" as const],
      label: "kenneth.eth",
    })),
    disconnect: jest.fn(async () => {}),
    restore: jest.fn(async () => [{ address: EXTERNAL }]),
    listConnectors: async () => [
      {
        id: "walletconnect" as const,
        name: "WalletConnect",
        kind: "external" as const,
        configured: true,
        installed: true,
        logoColor: "#3B99FC",
      },
    ],
    signer: jest.fn((address: string) => ({
      address,
      signMessage: async () => "0xexternal",
      signTypedData: async () => "0xexternal",
      signTransaction: async () => "0xexternal",
    })),
  };
}

describe("EmbeddedWalletGateway", () => {
  it("has no accounts and refuses to connect before a wallet is provisioned", async () => {
    const { gateway } = setup();
    expect(await gateway.listAccounts()).toEqual([]);
    expect(await gateway.currentAccount()).toBeNull();
    await expect(gateway.connect("embedded")).rejects.toBeInstanceOf(
      WalletNotProvisionedError,
    );
  });

  it("creates a wallet, selects it, and reports it as not backed up", async () => {
    const { gateway, seeded } = setup();
    const { account, mnemonic } = await gateway.createWallet();
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(account).toMatchObject({
      connector: "embedded",
      current: true,
      backedUp: false,
    });
    expect(account.address).toBe(deriveAccount(mnemonic, 0).address);
    expect(seeded).toEqual([account.address]);

    await gateway.markBackedUp(account.address);
    expect((await gateway.currentAccount())?.backedUp).toBe(true);
  });

  it("imports a mnemonic and signs a message that recovers to that address", async () => {
    const { gateway } = setup();
    const account = await gateway.importMnemonic(PHRASE);
    expect(account.address).toBe(ADDRESS);

    const message = "sign in to example.com";
    const signature = await gateway.signMessage(ADDRESS, message);
    expect(verifyMessage(message, signature)).toBe(ADDRESS);
  });

  it("imports a private key and can reconnect to it later", async () => {
    const { gateway } = setup();
    const key = deriveAccount(PHRASE, 5).privateKey;
    const account = await gateway.importPrivateKey(key);
    expect(account.current).toBe(true);
    // 私钥导入的账户没有助记词可导出
    await expect(
      gateway.revealMnemonic(account.address, "reveal"),
    ).rejects.toThrow("without a mnemonic");

    const reconnected = await gateway.connect("embedded");
    expect(reconnected.address).toBe(account.address);
  });

  it("passes the caller's reason through to the signer", async () => {
    const { gateway, vault } = setup();
    await gateway.importMnemonic(PHRASE);
    const spy = jest.spyOn(vault, "withPrivateKey");
    await gateway.signMessage(ADDRESS, "hi", { reason: "确认登录" });
    expect(spy).toHaveBeenCalledWith(ADDRESS, "确认登录", expect.any(Function));
  });

  it("keeps keys when an embedded account is disconnected", async () => {
    const { gateway, vault } = setup();
    const { account } = await gateway.createWallet();
    await gateway.disconnect(account.address);
    // 断开只是取消选中；密钥仍在 Vault 里，否则用户资产就没了
    expect(await vault.has(account.address)).toBe(true);
    expect(await gateway.listAccounts()).toHaveLength(1);
    expect(await gateway.currentAccount()).toBeNull();
  });

  it("switches between several wallets and remembers the choice", async () => {
    const { gateway } = setup();
    const first = await gateway.importMnemonic(PHRASE, 0);
    const second = await gateway.importMnemonic(PHRASE, 1);
    expect(second.current).toBe(true);

    const switched = await gateway.switchAccount(first.address);
    expect(switched.current).toBe(true);
    const accounts = await gateway.listAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts.filter((item) => item.current)).toHaveLength(1);
    expect((await gateway.currentAccount())?.address).toBe(first.address);
  });

  it("reveals the mnemonic of a created wallet", async () => {
    const { gateway } = setup();
    const { account, mnemonic } = await gateway.createWallet();
    await expect(
      gateway.revealMnemonic(account.address, "reveal"),
    ).resolves.toBe(mnemonic);
  });

  it("renames accounts and keeps labels across reads", async () => {
    const { gateway } = setup();
    const { account } = await gateway.createWallet();
    await gateway.rename(account.address, "日常钱包");
    expect((await gateway.currentAccount())?.label).toBe("日常钱包");
  });

  it("keeps the built-in wallet in the connector list alongside external ones", async () => {
    const external = fakeExternal();
    const { gateway } = setup({ external });
    const connectors = await gateway.listConnectors();
    // 外部连接器只负责外部钱包，不能把内置钱包项吞掉
    expect(connectors.filter((item) => item.kind === "embedded")).toHaveLength(
      1,
    );
    expect(
      connectors.filter((item) => item.kind === "external").length,
    ).toBeGreaterThan(0);
  });

  it("marks external connectors unavailable when no connector is wired", async () => {
    const { gateway } = setup();
    const connectors = await gateway.listConnectors();
    expect(connectors.filter((item) => item.kind === "embedded")).toHaveLength(
      1,
    );
    expect(connectors.filter((item) => item.kind === "external")).not.toEqual(
      [],
    );
    for (const connector of connectors)
      if (connector.kind === "external")
        expect(connector.installed).toBe(false);
    await expect(gateway.connect("metamask")).rejects.toBeInstanceOf(
      WalletProvisioningUnsupportedError,
    );
  });

  it("connects an external wallet and routes signing to it", async () => {
    const external = fakeExternal();
    const { gateway, vault } = setup({ external });
    const account = await gateway.connect("walletconnect");
    expect(account).toMatchObject({
      address: EXTERNAL,
      label: "kenneth.eth",
      connector: "walletconnect",
      current: true,
      backedUp: true,
    });
    expect(await vault.has(EXTERNAL)).toBe(false);
    await expect(gateway.signMessage(EXTERNAL, "hi")).resolves.toBe(
      "0xexternal",
    );
    expect(external.signer).toHaveBeenCalledWith(EXTERNAL);
  });

  it("forgets an external wallet on disconnect", async () => {
    const external = fakeExternal();
    const { gateway } = setup({ external });
    await gateway.connect("walletconnect");
    await gateway.disconnect(EXTERNAL);
    expect(external.disconnect).toHaveBeenCalledWith(EXTERNAL);
    expect(await gateway.listAccounts()).toHaveLength(0);
  });

  it("lists embedded and external accounts side by side", async () => {
    const external = fakeExternal();
    const { gateway } = setup({ external });
    await gateway.importMnemonic(PHRASE);
    await gateway.connect("walletconnect");
    const accounts = await gateway.listAccounts();
    expect(accounts.map((item) => item.connector).sort()).toEqual([
      "embedded",
      "walletconnect",
    ]);
    expect(accounts.filter((item) => item.current)).toHaveLength(1);
  });

  it("restores a cold-started external session instead of failing to sign", async () => {
    const external = fakeExternal();
    // 模拟冷启动：registry 里还有外部账户，但连接器内存里没有连接
    let connected = false;
    external.signer = jest.fn((address: string) => {
      if (!connected) throw new Error("wallet is not connected");
      return {
        address,
        signMessage: async () => "0xrestored",
        signTypedData: async () => "0xrestored",
        signTransaction: async () => "0xrestored",
      };
    });
    external.restore = jest.fn(async () => {
      connected = true;
      return [{ address: EXTERNAL }];
    });
    const { gateway } = setup({ external });
    await gateway.connect("walletconnect");

    await expect(gateway.signMessage(EXTERNAL, "hi")).resolves.toBe(
      "0xrestored",
    );
    expect(external.restore).toHaveBeenCalled();
  });

  it("refuses to sign for an account it does not know", async () => {
    const { gateway } = setup();
    await expect(gateway.signMessage(EXTERNAL, "hi")).rejects.toThrow(
      "no signer is available",
    );
  });

  it("delegates chain data to the injected source", async () => {
    const { gateway, chainData } = setup();
    const spy = jest.spyOn(chainData, "getBalances");
    const { account } = await gateway.createWallet();
    await gateway.getBalances(account.address);
    expect(spy).toHaveBeenCalledWith(account.address, undefined);
    expect(await gateway.listChains()).not.toHaveLength(0);
  });
});
