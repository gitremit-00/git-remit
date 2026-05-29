"use client";
import Header from "../../components/Header";
import KYCGate from "../../components/KYCGate";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Pencil, Trash2, Check, X, Copy, ArrowRight, UserCircle, Send } from "lucide-react";
import Link from "next/link";
import { getAllMeta, savePledgeMeta, deletePledgeMeta, PledgeMeta } from "../../lib/pledgeMeta";

interface Entry { addr: string; meta: PledgeMeta; }

export default function Recipients() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editAddr, setEditAddr] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => { reload(); }, []);

  function reload() {
    const all = getAllMeta();
    setEntries(Object.entries(all).map(([addr, meta]) => ({ addr, meta })));
  }

  function startEdit(e: Entry) { setEditAddr(e.addr); setEditName(e.meta.name); setEditNote(e.meta.note); }
  function saveEdit() { if (!editAddr) return; savePledgeMeta(editAddr, { name: editName, note: editNote }); setEditAddr(null); reload(); }
  function cancelEdit() { setEditAddr(null); }
  function doDelete(addr: string) { deletePledgeMeta(addr); setDeleteConfirm(null); reload(); }
  function copyAddr(addr: string) { navigator.clipboard.writeText(addr); setCopied(addr); setTimeout(() => setCopied(null), 1800); }

  /* ── DESKTOP ── */
  const DesktopView = (
    <div className="hidden md:block p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-extrabold text-white">Recipients</h1>
        <Link href="/new-transfer" className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors">
          <Send size={14} /> New Transfer
        </Link>
      </div>
      <p className="text-[#555] text-sm mb-8">Saved merchant addresses. Added automatically after your first transfer.</p>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#13161c] border border-[#1e2230] flex items-center justify-center mb-4">
            <Users size={28} color="#333" />
          </div>
          <div className="font-bold text-white text-lg mb-1.5">No saved recipients</div>
          <div className="text-[#555] text-sm max-w-[320px] mb-6">Recipients are saved automatically after your first transaction with them.</div>
          <Link href="/new-transfer" className="bg-[#DDE048] text-black font-bold rounded-xl px-8 py-2.5 text-sm">+ New Transfer</Link>
        </div>
      ) : (
        <>
          <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">{entries.length} SAVED RECIPIENT{entries.length !== 1 ? "S" : ""}</div>
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
            {entries.map((e, i) => (
              <div key={e.addr} className={`${i < entries.length - 1 ? "border-b border-[#1e2230]" : ""}`}>

                {editAddr === e.addr ? (
                  <div className="px-6 py-5">
                    <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">EDITING · {e.addr.slice(0, 10)}…{e.addr.slice(-8)}</div>
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <input
                          className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-[#333] mb-2"
                          placeholder="Recipient name"
                          value={editName}
                          onChange={(ev) => setEditName(ev.target.value)}
                        />
                        <input
                          className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-[#333]"
                          placeholder="Note (optional)"
                          value={editNote}
                          onChange={(ev) => setEditNote(ev.target.value)}
                        />
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={saveEdit} className="flex items-center gap-1.5 bg-[#DDE048] text-black rounded-xl px-4 py-2.5 text-sm font-bold">
                          <Check size={13} /> Save
                        </button>
                        <button onClick={cancelEdit} className="flex items-center gap-1.5 bg-[#1e2230] text-[#888] rounded-xl px-4 py-2.5 text-sm font-semibold">
                          <X size={13} /> Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : deleteConfirm === e.addr ? (
                  <div className="px-6 py-5 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white mb-0.5">Remove {e.meta.name || "this recipient"}?</div>
                      <div className="text-xs text-[#555]">This won't affect existing pledges.</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => doDelete(e.addr)} className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-2.5 text-sm font-semibold">
                        <Trash2 size={13} /> Remove
                      </button>
                      <button onClick={() => setDeleteConfirm(null)} className="bg-[#1e2230] text-[#888] rounded-xl px-4 py-2.5 text-sm font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="px-6 py-4 flex items-center gap-4 hover:bg-[#15181f] transition-colors group">
                    <div className="w-10 h-10 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0">
                      <UserCircle size={22} color="#DDE048" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white text-sm">{e.meta.name || "Unnamed"}</div>
                      {e.meta.note && <div className="text-xs text-[#555] mt-0.5">{e.meta.note}</div>}
                    </div>
                    <div className="font-mono text-xs text-[#555]">{e.addr.slice(0, 10)}…{e.addr.slice(-8)}</div>
                    <button onClick={() => copyAddr(e.addr)} className="w-8 h-8 rounded-lg bg-[#1e2230] flex items-center justify-center hover:bg-[#252836] transition-colors">
                      {copied === e.addr ? <Check size={13} color="#22c55e" /> : <Copy size={13} color="#555" />}
                    </button>
                    <button onClick={() => startEdit(e)} className="w-8 h-8 rounded-lg bg-[#1e2230] flex items-center justify-center hover:bg-[#252836] transition-colors">
                      <Pencil size={13} color="#555" />
                    </button>
                    <button onClick={() => setDeleteConfirm(e.addr)} className="w-8 h-8 rounded-lg bg-[#1e2230] flex items-center justify-center hover:bg-red-500/10 transition-colors">
                      <Trash2 size={13} color="#555" />
                    </button>
                    <button
                      onClick={() => router.push(`/new-transfer?to=${e.addr}`)}
                      className="flex items-center gap-1.5 bg-[#DDE048]/10 border border-[#DDE048]/20 text-[#DDE048] rounded-xl px-4 py-2 text-xs font-semibold hover:bg-[#DDE048]/20 transition-colors"
                    >
                      Send <ArrowRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  /* ── MOBILE ── */
  const MobileView = (
    <div className="md:hidden">
      <Header title="Recipients" />
      <div className="px-4 pt-5 pb-24">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#11141A] border border-[#1F2127] flex items-center justify-center">
              <Users size={28} color="#333" />
            </div>
            <div>
              <div className="font-bold text-base mb-1">No saved recipients</div>
              <div className="text-sm text-[#888] max-w-[260px]">Recipients are saved automatically after your first transaction with them</div>
            </div>
            <Link href="/new-transfer" className="bg-[#DDE048] text-black rounded-2xl px-8 py-3 text-sm font-bold">+ New Transfer</Link>
          </div>
        ) : (
          <>
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">{entries.length} SAVED RECIPIENT{entries.length !== 1 ? "S" : ""}</div>
            {entries.map((e) => (
              <div key={e.addr} className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
                {editAddr === e.addr ? (
                  <div>
                    <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">EDITING</div>
                    <input className="w-full bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-2.5 text-white text-sm outline-none mb-2" placeholder="Recipient name" value={editName} onChange={(ev) => setEditName(ev.target.value)} />
                    <input className="w-full bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-2.5 text-white text-sm outline-none mb-3" placeholder="Note (optional)" value={editNote} onChange={(ev) => setEditNote(ev.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" onClick={saveEdit} className="flex-1 bg-[#DDE048] text-black rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer border-0"><Check size={14} /> Save</button>
                      <button type="button" onClick={cancelEdit} className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"><X size={14} /> Cancel</button>
                    </div>
                  </div>
                ) : deleteConfirm === e.addr ? (
                  <div>
                    <div className="text-sm font-semibold mb-1">Remove {e.meta.name || "this recipient"}?</div>
                    <div className="text-xs text-[#888] mb-4">This won&apos;t affect existing pledges.</div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => doDelete(e.addr)} className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"><Trash2 size={13} /> Remove</button>
                      <button type="button" onClick={() => setDeleteConfirm(null)} className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center cursor-pointer">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center shrink-0"><UserCircle size={22} color="#DDE048" /></div>
                        <div className="min-w-0">
                          <div className="font-bold text-[15px] truncate">{e.meta.name || "Unnamed"}</div>
                          {e.meta.note && <div className="text-[11px] text-[#888] truncate">{e.meta.note}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => startEdit(e)} className="w-8 h-8 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center cursor-pointer"><Pencil size={13} color="#666" /></button>
                        <button type="button" onClick={() => setDeleteConfirm(e.addr)} className="w-8 h-8 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center cursor-pointer"><Trash2 size={13} color="#666" /></button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-2 mb-3">
                      <span className="font-mono text-[12px] text-[#888]">{e.addr.slice(0, 10)}...{e.addr.slice(-8)}</span>
                      <button type="button" onClick={() => copyAddr(e.addr)} className="cursor-pointer">
                        {copied === e.addr ? <Check size={13} color="#22c55e" /> : <Copy size={13} color="#555" />}
                      </button>
                    </div>
                    <button type="button" onClick={() => router.push(`/new-transfer?to=${e.addr}`)} className="w-full bg-[#DDE048]/10 border border-[#DDE048]/20 text-[#DDE048] rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
                      Send again <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );

  return (
    <KYCGate featureName="Recipients">
      {DesktopView}
      {MobileView}
    </KYCGate>
  );
}
