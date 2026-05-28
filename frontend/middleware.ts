import { NextRequest, NextResponse } from "next/server";
import { isSenderOnly, isMerchantOnly, isAdminOnly, isPublic } from "./lib/routes";
import { verifySessionCookie } from "./lib/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
  const role = session?.role;

  if (pathname === "/" && !role) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Public routes (/login, /signup) — redirect known users to their dashboard
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Legacy /onboarding → /login
  if (pathname === "/onboarding") {
    if (role) {
      if (role === "admin") return NextResponse.redirect(new URL("/admin", req.url));
      return NextResponse.redirect(new URL(role === "merchant" ? "/merchant" : "/", req.url));
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // No role cookie → /login
  if (!role) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Admin-only routes — block non-admins
  if (isAdminOnly(pathname) && role !== "admin") {
    return NextResponse.redirect(new URL(role === "merchant" ? "/merchant" : "/", req.url));
  }

  // Role-based route guards
  if (role === "sender" && isMerchantOnly(pathname)) {
    return NextResponse.redirect(new URL("/pledges", req.url));
  }
  if (role === "merchant" && isSenderOnly(pathname)) {
    return NextResponse.redirect(new URL("/merchant", req.url));
  }
  // Admin should not accidentally land on sender/merchant routes
  if (role === "admin" && (isSenderOnly(pathname) || isMerchantOnly(pathname))) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.png$).*)",
  ],
};
