import type { AssetSymbol } from "./asset";

export type PledgeStatus = "created" | "partially_locked" | "funded" | "released" | "cancelled";

export type Pledge = {
  id: string;
  contractPledgeId?: number;
  senderId: string;
  merchantId: string;
  assetSymbol: AssetSymbol;
  totalAmount: string;
  depositedAmount: string;
  status: PledgeStatus;
};
