"use client";
import { useState, useEffect } from "react";
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

  useEffect(() => {
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
      <div className="grid grid-cols-7 gap-y-0.5 mb-4">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const past = isPast(day);
          const sel  = isSelected(day);
          const tod  = isToday(day);
          return (
            <button
              key={i}
              type="button"
              disabled={past}
              onClick={() => selectDay(day)}
              className={`mx-auto w-8 h-8 rounded-lg text-[13px] font-medium flex items-center justify-center transition-all
                ${sel  ? "bg-[#DDE048] text-black font-bold"
                : tod  ? "border border-[#DDE048]/40 text-[#DDE048]"
                : past ? "text-[#2a2a2a] cursor-not-allowed"
                :        "text-[#777] hover:bg-[#1e2230] hover:text-white"}`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Time — simple dropdowns */}
      <div className="flex items-center gap-2 border-t border-[#1e2230] pt-3">
        <span className="text-[11px] text-[#555] tracking-wider shrink-0">TIME</span>
        <select
          value={hour}
          onChange={e => setHour(Number(e.target.value))}
          className="flex-1 bg-[#0e1014] border border-[#1e2230] rounded-lg px-2 py-1.5 text-white text-sm outline-none appearance-none cursor-pointer hover:border-[#333] transition-colors"
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{pad(i)}h</option>
          ))}
        </select>
        <span className="text-[#555]">:</span>
        <select
          value={minute}
          onChange={e => setMinute(Number(e.target.value))}
          className="flex-1 bg-[#0e1014] border border-[#1e2230] rounded-lg px-2 py-1.5 text-white text-sm outline-none appearance-none cursor-pointer hover:border-[#333] transition-colors"
        >
          {[0, 15, 30, 45].map(m => (
            <option key={m} value={m}>{pad(m)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
