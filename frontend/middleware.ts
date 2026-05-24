import { NextRequest, NextResponse } from "next/server";

const SENDER_ONLY = ["/", "/new-transfer", "/pledges", "/pledge", "/recipients"];
const MERCHANT_ONLY = ["/merchant"];

function isSenderOnly(path: string) {
  return SENDER_ONLY.some((r) => path === r || path.startsWith(r + "/"));
}
function isMerchantOnly(path: string) {
  return MERCHANT_ONLY.some((r) => path === r || path.startsWith(r + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = req.cookies.get("rs_role")?.value;

  // No role cookie → new user, send to onboarding
  if (!role) {
    if (pathname !== "/onboarding") {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
    return NextResponse.next();
  }

  // Known user — block wrong-role routes
  if (role === "sender" && isMerchantOnly(pathname)) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (role === "merchant" && isSenderOnly(pathname)) {
    return NextResponse.redirect(new URL("/merchant", req.url));
  }

  // Known user landing on onboarding → send to their dashboard
  if (pathname === "/onboarding") {
    return NextResponse.redirect(new URL(role === "merchant" ? "/merchant" : "/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.png$).*)",
  ],
};
