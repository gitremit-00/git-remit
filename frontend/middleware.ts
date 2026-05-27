import { NextRequest, NextResponse } from "next/server";
import { isSenderOnly, isMerchantOnly, isAdminOnly, isPublic } from "./lib/routes";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = req.cookies.get("rs_role")?.value;

  // Public routes (/login, /signup) — redirect known users to their dashboard
  if (isPublic(pathname)) {
    if (role) {
      if (role === "admin") return NextResponse.redirect(new URL("/admin", req.url));
      if (role === "merchant") return NextResponse.redirect(new URL("/merchant", req.url));
      return NextResponse.redirect(new URL("/", req.url));
    }
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
    return NextResponse.redirect(new URL("/", req.url));
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
