export type UserRole = "sender" | "merchant" | "admin";

export type User = {
  id: string;
  walletAddress: string;
  role: UserRole;
  fullName: string;
  faceVerified: boolean;
  idVerified: boolean;
  reputationScore: number;
};
