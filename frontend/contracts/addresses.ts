export const CONTRACTS = {
  MOCK_USDC: "0x165186FCF4b2c145bEA0073ef3cb1f2b1F3837da",
  MOCK_USDT: "0xb49a61765a05fE938491507e3A02873ACD4cD8dc",
  REMITTANCE_PLEDGE: "0x18d74B544Fa754f1A8927e916506205b9dbF2721",
} as const;

export const MORPH_TESTNET = {
  chainId: "0xB5E",
  chainName: "Morph Hoodi",
  rpcUrls: ["https://rpc-hoodi.morph.network"],
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://explorer-hoodi.morph.network"],
} as const;

export const PHP_PER_USDC = 56;
