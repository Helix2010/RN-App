import { randomBytes } from "ethers";
import {
  WrapKeyEnvelopeError,
  newDeviceKey,
  openWrapKey,
  sealWrapKey,
} from "./wrap-key-envelope";
import { WalletPassphraseError } from "./passphrase";

const FAST = { N: 2 ** 14, r: 8, p: 1 };
const PASSPHRASE = "correct horse battery";

async function seal(wrapKey = randomBytes(32), deviceKey = newDeviceKey()) {
  return {
    wrapKey,
    deviceKey,
    envelope: await sealWrapKey({
      wrapKey,
      deviceKey,
      passphrase: PASSPHRASE,
      params: FAST,
    }),
  };
}

describe("包裹密钥的第二份封装（B 路）", () => {
  it("口令 + 设备密钥齐了就能拿回同一把 WK", async () => {
    const { wrapKey, deviceKey, envelope } = await seal();

    const opened = await openWrapKey({
      envelope,
      deviceKey,
      passphrase: PASSPHRASE,
    });

    expect(Array.from(opened)).toEqual(Array.from(wrapKey));
  });

  it("口令不对报口令不对——用户得知道自己是打错了字", async () => {
    const { deviceKey, envelope } = await seal();

    await expect(
      openWrapKey({ envelope, deviceKey, passphrase: "wrong passphrase" }),
    ).rejects.toThrow(WalletPassphraseError);
  });

  it("换一台设备（设备密钥不对）报的是另一件事，不是口令错", async () => {
    const { envelope } = await seal();

    await expect(
      openWrapKey({
        envelope,
        deviceKey: newDeviceKey(),
        passphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(WrapKeyEnvelopeError);
  });

  // 外层就是为了这件事存在的：把存储整个捞走的人，拿到的信封毫无用处
  it("只拿到信封、没有设备密钥，口令再对也打不开", async () => {
    const { envelope } = await seal();

    await expect(
      openWrapKey({
        envelope,
        deviceKey: newDeviceKey(),
        passphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(/cannot be opened on this device/);
  });

  it("把 KDF 参数调弱再存回来，直接拒绝", async () => {
    const { deviceKey, envelope } = await seal();
    const weakened = { ...envelope, kdf: { ...envelope.kdf, N: 2 ** 8 } };

    await expect(
      openWrapKey({ envelope: weakened, deviceKey, passphrase: PASSPHRASE }),
    ).rejects.toThrow(/too weak/);
  });

  it("改盐会让内层认证失败，而不是悄悄按另一把密钥走", async () => {
    const { deviceKey, envelope } = await seal();
    const swapped = {
      ...envelope,
      kdf: { ...envelope.kdf, salt: envelope.kdf.salt.replace(/^./, "A") },
    };

    await expect(
      openWrapKey({ envelope: swapped, deviceKey, passphrase: PASSPHRASE }),
    ).rejects.toThrow();
  });

  it("密文被改过就是坏了", async () => {
    const { deviceKey, envelope } = await seal();
    const broken = { ...envelope, ciphertext: `A${envelope.ciphertext.slice(1)}` };

    await expect(
      openWrapKey({ envelope: broken, deviceKey, passphrase: PASSPHRASE }),
    ).rejects.toThrow(WrapKeyEnvelopeError);
  });

  it("版本不认识就拒，不去猜格式", async () => {
    const { deviceKey, envelope } = await seal();

    await expect(
      openWrapKey({
        envelope: { ...envelope, version: 2 as unknown as 1 },
        deviceKey,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(/unknown envelope version/);
  });

  it("同一把 WK 封两次得到不同的密文——盐和 nonce 都是新的", async () => {
    const wrapKey = randomBytes(32);
    const deviceKey = newDeviceKey();
    const first = await sealWrapKey({ wrapKey, deviceKey, passphrase: PASSPHRASE, params: FAST });
    const second = await sealWrapKey({ wrapKey, deviceKey, passphrase: PASSPHRASE, params: FAST });

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
  });
});
