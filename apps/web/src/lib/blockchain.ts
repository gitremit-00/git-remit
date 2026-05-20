export const REMITSAFE_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_REMITSAFE_CONTRACT_ADDRESS ?? "";

export function isNativeAsset(symbol: string) {
  return symbol.toUpperCase() === "ETH";
}
