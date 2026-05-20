export const SUPPORTED_ASSETS = [
  {
    symbol: "ETH",
    name: "Ether",
    type: "native",
    decimals: 18
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    type: "erc20",
    decimals: 6
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    type: "erc20",
    decimals: 6
  }
] as const;
