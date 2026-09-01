import type { TokenRef } from "../../../core/gateways/types";
import type { WalletConnector } from "../model/wallet";

export const CONNECTORS: WalletConnector[] = [
  {
    id: "embedded",
    name: "内置钱包",
    kind: "embedded",
    installed: true,
    logoColor: "#F0B90B",
  },
  {
    id: "metamask",
    name: "MetaMask",
    kind: "external",
    installed: true,
    logoColor: "#F6851B",
  },
  {
    id: "okx",
    name: "OKX Wallet",
    kind: "external",
    installed: false,
    logoColor: "#000000",
  },
  {
    id: "trust",
    name: "Trust Wallet",
    kind: "external",
    installed: false,
    logoColor: "#3375BB",
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    kind: "external",
    installed: true,
    logoColor: "#3B99FC",
  },
];

/** Mock 模式下的演示助记词（真实模式由 KeystoreVault 生成，绝不写进代码）。 */
export const MOCK_MNEMONIC =
  "ripple harbor velvet orbit candle meadow silver anchor pioneer glacier timber lantern";

export const EXTERNAL_ADDRESS = "0x3f4a8c21b7d94e0a1f6c5d2e8b9a7c3d4e5f9a2c";
export const EMBEDDED_ADDRESS = "0x8a1c6e0f3b7d2a9c5e4f1b8d7a6c3e2f9b0df042";

export const TOKENS: Record<string, TokenRef> = {
  BNB: {
    chain: "bsc",
    address: "native",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    logoColor: "#F0B90B",
    verified: true,
  },
  "USDT.bsc": {
    chain: "bsc",
    address: "0x55d398326f99059ff775485246999027b3197955",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    logoColor: "#26A17B",
    verified: true,
  },
  "USDC.bsc": {
    chain: "bsc",
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 18,
    logoColor: "#2775CA",
    verified: true,
  },
  PEPE: {
    chain: "bsc",
    address: "0x25d887ce7a35172c62febfd67a1856f20faebb00",
    symbol: "PEPE",
    name: "Pepe",
    decimals: 18,
    logoColor: "#4CAF50",
    verified: true,
  },
  CAKE: {
    chain: "bsc",
    address: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
    symbol: "CAKE",
    name: "PancakeSwap",
    decimals: 18,
    logoColor: "#1E88E5",
    verified: true,
  },
  ETH: {
    chain: "eth",
    address: "native",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    logoColor: "#627EEA",
    verified: true,
  },
  "USDC.eth": {
    chain: "eth",
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoColor: "#2775CA",
    verified: true,
  },
  UNI: {
    chain: "eth",
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    symbol: "UNI",
    name: "Uniswap",
    decimals: 18,
    logoColor: "#FF007A",
    verified: true,
  },
  MOG: {
    chain: "eth",
    address: "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a",
    symbol: "MOG",
    name: "Mog Coin",
    decimals: 18,
    logoColor: "#E64980",
    verified: false,
  },
  "ETH.base": {
    chain: "base",
    address: "native",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    logoColor: "#627EEA",
    verified: true,
  },
  AERO: {
    chain: "base",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    symbol: "AERO",
    name: "Aerodrome",
    decimals: 18,
    logoColor: "#0052FF",
    verified: true,
  },
  ZORA: {
    chain: "base",
    address: "0x1111111111166b7fe7bd91427724b487980afc69",
    symbol: "ZORA",
    name: "Zora",
    decimals: 18,
    logoColor: "#7C5CFF",
    verified: false,
  },
};

/** 每个代币的 USD 参考价（Mock 世界的行情源）。 */
export const REFERENCE_PRICES_USD: Record<string, number> = {
  BNB: 624.8,
  "USDT.bsc": 1,
  "USDC.bsc": 1,
  PEPE: 0.00001234,
  CAKE: 2.84,
  ETH: 4500,
  "USDC.eth": 1,
  UNI: 10.62,
  MOG: 0.0000018,
  "ETH.base": 4500,
  AERO: 0.912,
  ZORA: 0.0412,
};

export function tokenKey(token: TokenRef): string {
  const found = Object.entries(TOKENS).find(
    ([, ref]) => ref.chain === token.chain && ref.address === token.address,
  );
  return found?.[0] ?? `${token.symbol}.${token.chain}`;
}
