export const CONTRACTS = {
  MOCK_USDC: "0xc24E2cF63A804E76153C9B99aa81846033963F67",
  REMITTANCE_PLEDGE: "0x688ffbe7A0Fed72c5bAcAC038A9708238794a845",
} as const;

export const MORPH_TESTNET = {
  chainId: "0xB5E",
  chainName: "Morph Hoodi",
  rpcUrls: ["https://rpc-hoodi.morph.network"],
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://explorer-hoodi.morph.network"],
} as const;

export const PHP_PER_USDC = 56;
