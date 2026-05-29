const PUBLIC_ROUTES = ["/login", "/signup"];
const ADMIN_PREFIXES = ["/admin"];
const MERCHANT_PREFIXES = ["/merchant"];

// Pages only OFW senders can access
const SENDER_ONLY_PREFIXES = [
  "/new-transfer",
  "/pledges",
  "/pledge",
  "/recipients",
];

// Pages accessible by both senders and merchants
const SHARED_PREFIXES = [
  "/wallet",
  "/profile",
  "/settings",
  "/notifications",
  "/help",
  "/kyc-revision",
];

function matches(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isPublic(pathname: string) {
  return pathname.startsWith("/api") || matches(pathname, PUBLIC_ROUTES);
}

export function isAdminOnly(pathname: string) {
  return matches(pathname, ADMIN_PREFIXES);
}

export function isMerchantOnly(pathname: string) {
  return matches(pathname, MERCHANT_PREFIXES);
}

export function isShared(pathname: string) {
  return matches(pathname, SHARED_PREFIXES);
}

export function isSenderOnly(pathname: string) {
  if (pathname === "/") return true;
  return matches(pathname, SENDER_ONLY_PREFIXES);
}
