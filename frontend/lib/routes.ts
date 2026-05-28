const PUBLIC_ROUTES = ["/login", "/signup"];
const ADMIN_PREFIXES = ["/admin"];
const MERCHANT_PREFIXES = ["/merchant"];
const SENDER_PREFIXES = [
  "/",
  "/new-transfer",
  "/pledges",
  "/pledge",
  "/recipients",
  "/wallet",
  "/profile",
  "/settings",
  "/notifications",
  "/help",
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

export function isSenderOnly(pathname: string) {
  if (pathname === "/") return true;
  return matches(pathname, SENDER_PREFIXES.filter((route) => route !== "/"));
}
