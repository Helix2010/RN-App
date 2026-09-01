import { Wallet, type TypedDataDomain, type TypedDataField } from "ethers";
import type { KeystoreVault } from "../vault/keystore-vault";
import type {
  EvmTransactionRequest,
  SignRequestContext,
  WalletSigner,
} from "./types";

/**
 * 内置自托管钱包的签名器。所有取密钥都经 `vault.withPrivateKey`：
 * 私钥只在回调作用域内存在，签名完即失去引用；身份验证由 Vault 内部强制。
 *
 * 本文件刻意不 import 任何网络模块 —— 签名与广播分离，对应 Robinhood 把签名放进
 * 只有"消息总线 + RNG"能力的 WASM 沙箱（逆向 E-018）。
 */
export class EmbeddedSigner implements WalletSigner {
  constructor(
    readonly address: string,
    private readonly vault: KeystoreVault,
  ) {}

  async signMessage(
    message: string,
    context: SignRequestContext,
  ): Promise<string> {
    return this.vault.withPrivateKey(this.address, context.reason, (key) =>
      new Wallet(key).signMessage(message),
    );
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
    context: SignRequestContext,
  ): Promise<string> {
    return this.vault.withPrivateKey(this.address, context.reason, (key) =>
      new Wallet(key).signTypedData(domain, types, value),
    );
  }

  async signTransaction(
    transaction: EvmTransactionRequest,
    context: SignRequestContext,
  ): Promise<string> {
    return this.vault.withPrivateKey(this.address, context.reason, (key) =>
      new Wallet(key).signTransaction({
        ...transaction,
        from: transaction.from ?? this.address,
      }),
    );
  }
}
