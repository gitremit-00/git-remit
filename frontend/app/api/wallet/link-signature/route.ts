import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { adminClient, requireKYCVerified } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";
import { deriveAccountId } from "../../../../lib/accountId";
import RemittancePledgeABI from "../../../../contracts/RemittancePledge.json";
import { CONTRACTS } from "../../../../contracts/addresses";

const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const CHAIN_ID = 2910; // Morph Hoodi testnet
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;

// In-memory rate limiter (per-profile)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(profileId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(profileId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(profileId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const holdErr = await requireKYCVerified(session.userId);
    if (holdErr) return holdErr;

    const { walletAddress } = (await req.json()) as { walletAddress?: string };
    if (!walletAddress || !WALLET_RE.test(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    if (!checkRateLimit(session.userId)) {
      return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
    }

    const normalized = walletAddress.toLowerCase();
    const admin = adminClient();

    // Pre-flight: wallet not linked elsewhere
    const { data: existing } = await admin
      .from("profile_wallets")
      .select("profile_id")
      .eq("wallet_address", normalized)
      .maybeSingle();

    if (existing && existing.profile_id !== session.userId) {
      return NextResponse.json({ error: "Wallet is already linked to another account." }, { status: 409 });
    }

    const operatorKey = process.env.LINK_OPERATOR_PRIVATE_KEY;
    if (!operatorKey) throw new Error("LINK_OPERATOR_PRIVATE_KEY not set");

    const accountId = deriveAccountId(session.userId);
    const sigExpiry = Math.floor((Date.now() + 15 * 60 * 1000) / 1000); // 15 minutes from now

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, provider);
    const linkNonce = await contract.linkNonces(accountId) as bigint;

    const msgHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "bytes32", "address", "uint256", "uint256"],
      [CHAIN_ID, CONTRACTS.REMITTANCE_PLEDGE, "link", accountId, walletAddress, sigExpiry, linkNonce]
    );

    const operatorWallet = new ethers.Wallet(operatorKey);
    const operatorSig = await operatorWallet.signMessage(ethers.getBytes(msgHash));

    return NextResponse.json({ accountId, sigExpiry, operatorSig });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
