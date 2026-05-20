export type AuthRole = "sender" | "merchant" | "admin";

export function canAccessDashboard(role: AuthRole, dashboard: AuthRole) {
  return role === dashboard || role === "admin";
}
