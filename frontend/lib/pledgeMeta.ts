export interface PledgeMeta {
  name: string;
  note: string;
}

export function savePledgeMeta(merchantAddr: string, meta: PledgeMeta) {
  try {
    const all: Record<string, PledgeMeta> = JSON.parse(localStorage.getItem("rs_meta") ?? "{}");
    all[merchantAddr.toLowerCase()] = meta;
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
