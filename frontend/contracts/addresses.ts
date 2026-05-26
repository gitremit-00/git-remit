export const CONTRACTS = {
  MOCK_USDC: "0xe3bC47ef2353391dE4BC9691A358e99F3e2a06CE",
  MOCK_USDT: "0xe7E4CdAED4a034380904c5DA5A26890015358bE5",
  REMITTANCE_PLEDGE: "0xd44280f56e1b8571f6b52D57Bc41bABD5c1e961A",
} as const;

export const MORPH_TESTNET = {
  chainId: "0xB5E",
  chainName: "Morph Hoodi",
  rpcUrls: ["https://rpc-hoodi.morph.network"],
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://explorer-hoodi.morph.network"],
} as const;

export const PHP_PER_USDC = 56;
