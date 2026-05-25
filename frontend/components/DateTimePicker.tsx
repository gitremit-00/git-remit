"use client";
import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) { return String(n).padStart(2, "0"); }

function toLocalISOString(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const today = new Date();
  const initial = value ? new Date(value) : null;

  const [viewYear, setViewYear]   = useState(initial?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial?.getMonth()    ?? today.getMonth());
  const [selected, setSelected]   = useState<Date | null>(initial);
  const [hour, setHour]     = useState(initial ? initial.getHours()   : 9);
  const [minute, setMinute] = useState(initial ? initial.getMinutes() : 0);
  const externalUpdate = useRef(false);

  // Sync calendar when value changes externally (quick-date buttons etc.)
  useEffect(() => {
    externalUpdate.current = true;
    if (!value) {
      setSelected(null);
      return;
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return;
    setSelected(d);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setHour(d.getHours());
    setMinute(d.getMinutes());
  }, [value]);

  // Emit onChange only for internal user interactions
  useEffect(() => {
    if (externalUpdate.current) {
      externalUpdate.current = false;
      return;
    }
    if (selected) {
      const d = new Date(selected);
      d.setHours(hour, minute, 0, 0);
      onChange(toLocalISOString(d));
    }
  }, [selected, hour, minute]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function selectDay(day: number) {
    setSelected(new Date(viewYear, viewMonth, day, hour, minute, 0, 0));
  }

  function isSelected(day: number) {
    return selected?.getFullYear() === viewYear &&
           selected?.getMonth() === viewMonth &&
           selected?.getDate() === day;
  }

  function isToday(day: number) {
    return today.getFullYear() === viewYear &&
           today.getMonth() === viewMonth &&
           today.getDate() === day;
  }

  function isPast(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return d < t;
  }

  function isInRange(day: number) {
    if (!selected) return false;
    const d = new Date(viewYear, viewMonth, day);
    d.setHours(0, 0, 0, 0);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(selected); end.setHours(0, 0, 0, 0);
    return d > start && d < end;
  }

  return (
    <div className="w-full">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={prevMonth}
          className="w-7 h-7 rounded-lg bg-[#0e1014] border border-[#1e2230] flex items-center justify-center hover:border-[#333] transition-colors">
          <ChevronLeft size={14} color="#666" />
        </button>
        <span className="text-sm font-bold text-white">{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth}
          className="w-7 h-7 rounded-lg bg-[#0e1014] border border-[#1e2230] flex items-center justify-center hover:border-[#333] transition-colors">
          <ChevronRight size={14} color="#666" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[11px] text-[#444] font-medium py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-y-1 mb-4">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="h-8" />;
          const past  = isPast(day);
          const sel   = isSelected(day);
          const tod   = isToday(day);
          const range = isInRange(day);
          const hasRange = selected !== null;
          const prevDay = cells[i - 1] as number | null;
          const nextDay = cells[i + 1] as number | null;
          const prevConnected = prevDay != null && (isInRange(prevDay) || isToday(prevDay));
          const nextConnected = nextDay != null && (isInRange(nextDay) || isSelected(nextDay));
          const capLeft  = range && !prevConnected;
          const capRight = range && !nextConnected;
          const BAND = "rgba(221,224,72,0.18)";
          return (
            <div key={i} className="relative h-8 flex items-center justify-center">
              {/* Full band for in-range days */}
              {range && (
                <div className={`absolute inset-y-0 inset-x-0 ${capLeft ? "rounded-l-full" : ""} ${capRight ? "rounded-r-full" : ""}`}
                  style={{ background: BAND }} />
              )}
              {/* Band starting from left edge of today's circle */}
              {tod && hasRange && (
                <div className="absolute inset-y-0 right-0 rounded-l-full" style={{ background: BAND, left: "calc(50% - 1rem)" }} />
              )}
              {/* Left-half band ending at selected's square center */}
              {sel && hasRange && (
                <div className="absolute inset-y-0 left-0 w-1/2 rounded-r-full" style={{ background: BAND }} />
              )}
              <button
                type="button"
                disabled={past}
                onClick={() => selectDay(day)}
                className={`w-8 h-8 text-[13px] font-medium flex items-center justify-center transition-all z-10 relative
                  ${sel   ? "bg-[#DDE048] text-black font-bold rounded-lg"
                  : tod   ? "border border-[#DDE048]/60 text-[#DDE048] rounded-full"
                  : past  ? "text-[#2a2a2a] cursor-not-allowed"
                  : range ? "text-[#DDE048]/90"
                  :         "text-[#777] hover:bg-[#1e2230] hover:text-white rounded-lg"}`}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>

      {/* Time picker */}
      <div className="border-t border-[#1e2230] pt-3">
        <div className="text-[11px] text-[#555] tracking-wider mb-2">TIME</div>
        <div className="flex items-center gap-2">
          {/* Hour drum */}
          <ScrollDrum
            values={Array.from({ length: 12 }, (_, i) => i + 1)}
            selected={hour % 12 === 0 ? 12 : hour % 12}
            onSelect={h12 => {
              const ispm = hour >= 12;
              setHour(ispm ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12));
            }}
            format={v => pad(v)}
          />

          <span className="text-[#555] font-bold text-lg shrink-0">:</span>

          {/* Minute drum */}
          <ScrollDrum
            values={Array.from({ length: 60 }, (_, i) => i)}
            selected={minute}
            onSelect={setMinute}
            format={v => pad(v)}
          />

          {/* AM / PM toggle */}
          <div className="flex flex-col shrink-0 rounded-xl overflow-hidden border border-[#1e2230]" style={{ height: 36 * 3 }}>
            {["AM", "PM"].map((period) => {
              const active = period === "AM" ? hour < 12 : hour >= 12;
              return (
                <button key={period} type="button"
                  onClick={() => {
                    if (period === "AM" && hour >= 12) setHour(hour - 12);
                    if (period === "PM" && hour < 12) setHour(hour + 12);
                  }}
                  className={`flex-1 w-12 text-xs font-bold transition-all ${active ? "bg-[#DDE048] text-black" : "bg-[#0a0c0f] text-[#444] hover:text-white hover:bg-[#1e2230]"}`}>
                  {period}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScrollDrum({ values, selected, onSelect, format }: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  format: (v: number) => string;
}) {
  const ITEM_H = 36;
  const VISIBLE = 3;
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startScroll = useRef(0);
  const lastY = useRef(0);
  const velocity = useRef(0);
  const rafId = useRef<number>(0);

  // Scroll to selected whenever it changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const idx = values.indexOf(selected);
    el.scrollTop = idx * ITEM_H;
  }, [selected, values]);

  function snapToNearest(el: HTMLDivElement) {
    const idx = Math.round(el.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    el.scrollTop = clamped * ITEM_H;
    if (values[clamped] !== selected) onSelect(values[clamped]);
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    cancelAnimationFrame(rafId.current);
    isDragging.current = true;
    startY.current = e.clientY;
    lastY.current = e.clientY;
    startScroll.current = el.scrollTop;
    velocity.current = 0;
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!isDragging.current) return;
    const el = containerRef.current;
    if (!el) return;
    velocity.current = lastY.current - e.clientY;
    lastY.current = e.clientY;
    el.scrollTop = startScroll.current + (startY.current - e.clientY);
  }

  function onPointerUp() {
    if (!isDragging.current) return;
    isDragging.current = false;
    const el = containerRef.current;
    if (!el) return;

    // Momentum flick
    function momentum() {
      if (!el || Math.abs(velocity.current) < 0.5) {
        snapToNearest(el!);
        return;
      }
      el.scrollTop += velocity.current;
      velocity.current *= 0.88;
      rafId.current = requestAnimationFrame(momentum);
    }
    rafId.current = requestAnimationFrame(momentum);
  }

  return (
    <div className="flex-1 relative rounded-xl overflow-hidden border border-[#1e2230]"
      style={{ height: ITEM_H * VISIBLE, background: "#0a0c0f" }}>

      {/* Scrollable list */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute inset-0 overflow-y-scroll cursor-grab active:cursor-grabbing select-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div style={{ height: ITEM_H }} />
        {values.map((v) => (
          <div
            key={v}
            onClick={() => onSelect(v)}
            style={{ height: ITEM_H }}
            className={`flex items-center justify-center font-semibold transition-all duration-100 ${
              v === selected ? "text-white text-[16px]" : "text-[#3a3a3a] text-[13px]"
            }`}
          >
            {format(v)}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>

      {/* Top fade overlay */}
      <div className="absolute inset-x-0 top-0 pointer-events-none z-10"
        style={{ height: ITEM_H, background: "linear-gradient(to bottom, #0a0c0f 0%, transparent 100%)" }} />

      {/* Bottom fade overlay */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
        style={{ height: ITEM_H, background: "linear-gradient(to top, #0a0c0f 0%, transparent 100%)" }} />

      {/* Centre highlight bar — sits on top of fades */}
      <div className="absolute inset-x-0 pointer-events-none z-20"
        style={{ top: ITEM_H, height: ITEM_H, background: "rgba(221,224,72,0.07)", borderTop: "1px solid rgba(221,224,72,0.15)", borderBottom: "1px solid rgba(221,224,72,0.15)" }} />
    </div>
  );
}
