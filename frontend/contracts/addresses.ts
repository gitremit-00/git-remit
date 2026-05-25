export const CONTRACTS = {
  MOCK_USDC: "0x3DF3a6D4C4757f006480274CF57AC47B00f9b9db",
  MOCK_USDT: "0xCb57Fc6Ed7f3A2c083D969aDC38aa9911B33d65C",
  REMITTANCE_PLEDGE: "0x77bf71Ec1E35a2C144B9df10B835dF44f3ef08f0",
} as const;

export const MORPH_TESTNET = {
  chainId: "0xB5E",
  chainName: "Morph Hoodi",
  rpcUrls: ["https://rpc-hoodi.morph.network"],
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://explorer-hoodi.morph.network"],
} as const;

export const PHP_PER_USDC = 56;
