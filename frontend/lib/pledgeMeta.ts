export interface PledgeMeta {
  name: string;
  note: string;
  type?: "merchant" | "p2p";
  uuid?: string; // profile UUID — used for new-transfer UUID lookup
}

export function savePledgeMeta(merchantAddr: string, meta: Partial<PledgeMeta> & { name: string; note: string }) {
  try {
    const all: Record<string, PledgeMeta> = JSON.parse(localStorage.getItem("rs_meta") ?? "{}");
    const existing = all[merchantAddr.toLowerCase()] ?? {};
    all[merchantAddr.toLowerCase()] = { ...existing, ...meta };
    localStorage.setItem("rs_meta", JSON.stringify(all));
  } catch {}
}

export function getPledgeMeta(merchantAddr: string): PledgeMeta | null {
  try {
    const all: Record<string, PledgeMeta> = JSON.parse(localStorage.getItem("rs_meta") ?? "{}");
    return all[merchantAddr.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

export function getAllMeta(): Record<string, PledgeMeta> {
  try {
    return JSON.parse(localStorage.getItem("rs_meta") ?? "{}");
  } catch {
    return {};
  }
}

export function deletePledgeMeta(merchantAddr: string) {
  try {
    const all: Record<string, PledgeMeta> = JSON.parse(localStorage.getItem("rs_meta") ?? "{}");
    delete all[merchantAddr.toLowerCase()];
    localStorage.setItem("rs_meta", JSON.stringify(all));
  } catch {}
}
