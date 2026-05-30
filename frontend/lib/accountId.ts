import { ethers } from "ethers";

export function deriveAccountId(profileUuid: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`remitsafe:account:${profileUuid}`));
}
