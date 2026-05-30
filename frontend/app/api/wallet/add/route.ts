import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { adminClient, requireKYCVerified } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";
import { deriveAccountId } from "../../../../lib/accountId";
import RemittancePledgeABI from "../../../../contracts/RemittancePledge.json";
import { CONTRACTS } from "../../../../contracts/addresses";

const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

export async function POST(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const holdErr = await requireKYCVerified(session.userId);
    if (holdErr) return holdErr;

    const { walletAddress, txHash } = (await req.json()) as { walletAddress?: string; txHash?: string };
    if (!walletAddress || !WALLET_RE.test(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }
    if (!txHash || !TX_RE.test(txHash)) {
      return NextResponse.json({ error: "Invalid txHash." }, { status: 400 });
    }

    // Verify tx is confirmed and wallet is linked on-chain
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return NextResponse.json({ error: "Transaction not confirmed on-chain." }, { status: 400 });
    }

    const contract = new ethers.Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, provider);
    const onChainAccountId = await contract.walletToAccount(walletAddress) as string;
    const expectedAccountId = deriveAccountId(session.userId);

    if (onChainAccountId !== expectedAccountId) {
      return NextResponse.json({ error: "Wallet is not linked to this account on-chain." }, { status: 400 });
    }

    const normalized = walletAddress.toLowerCase();
    const admin = adminClient();

    // Check if this is the first wallet for the profile
    const { count } = await admin
      .from("profile_wallets")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", session.userId);

    const isPrimary = (count ?? 0) === 0;

    const { error } = await admin.from("profile_wallets").upsert(
      { profile_id: session.userId, wallet_address: normalized, is_primary: isPrimary },
      { onConflict: "wallet_address" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, isPrimary });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
