/**
 * 金库内部的 base64。抽出来是因为口令层与条目层都要用，而它们互相 import 会成环。
 * 用 btoa/atob 而不是 Buffer：RN 里 Buffer 不一定被 polyfill，btoa/atob 是的。
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
