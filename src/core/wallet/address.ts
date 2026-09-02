import { getAddress } from "ethers";

/**
 * 收款地址在输入阶段的三态。
 *
 * 只用正则查"40 位十六进制"会放过一类最危险的错误：**大小写混合但校验和不对**。
 * 这几乎总是手抄错了一个字符——如果直接拒绝会让用户以为格式不对去改格式；
 * 如果放过，签名前 ethers 会拦（我们验过 `encodeFunctionData` 也会抛），但那时
 * 用户只能看到一句"转出失败"，而且已经在确认页看到过一个绿色的"格式校验通过"。
 * 所以这里要把它单独叫出来。全小写与全大写没有校验和信息，按有效处理（交易所常给）。
 */
export type EvmAddressVerdict = "valid" | "checksum" | "invalid";

const HEX40 = /^0x[0-9a-fA-F]{40}$/;

/** 归一成 EIP-55 校验和形式；输入必须已经是合法地址。 */
export function normalizeEvmAddress(input: string): string {
  return getAddress(input.trim());
}

export function classifyEvmAddress(input: string): EvmAddressVerdict {
  const value = input.trim();
  if (!HEX40.test(value)) return "invalid";
  try {
    getAddress(value);
    return "valid";
  } catch {
    return "checksum";
  }
}
