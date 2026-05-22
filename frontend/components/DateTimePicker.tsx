"use client";
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DateTimePickerProps {
  value: string; // datetime-local format: "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

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

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function selectDay(day: number) {
    const d = new Date(viewYear, viewMonth, day, hour, minute, 0, 0);
    setSelected(d);
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

  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 15, 30, 45];

  return (
    <div className="w-full">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={prevMonth} className="w-8 h-8 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center cursor-pointer">
          <ChevronLeft size={16} color="#888" />
        </button>
        <span className="font-bold text-sm text-white">{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth} className="w-8 h-8 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center cursor-pointer">
          <ChevronRight size={16} color="#888" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[11px] text-[#555] font-semibold py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-y-1 mb-4">
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
              className={`mx-auto w-8 h-8 rounded-full text-[13px] font-medium flex items-center justify-center cursor-pointer border transition-all
                ${sel     ? "bg-[#DDE048] border-[#DDE048] text-black font-bold"
                : tod     ? "bg-transparent border-[#DDE048] text-[#DDE048]"
                : past    ? "text-[#333] border-transparent cursor-not-allowed"
                :           "text-[#ccc] border-transparent hover:bg-[#1e1e1e] hover:border-[#2a2a2a]"}`}
            >{day}</button>
          );
        })}
      </div>

      {/* Time picker */}
      <div className="border-t border-[#1F2127] pt-3">
        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">TIME</div>
        <div className="flex gap-2">
          {/* Hour */}
          <div className="flex-1">
            <div className="text-[10px] text-[#555] mb-1">Hour</div>
            <select
              value={hour}
              onChange={e => setHour(Number(e.target.value))}
              className="w-full bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-2 text-white text-sm outline-none appearance-none cursor-pointer"
            >
              {hours.map(h => (
                <option key={h} value={h}>{pad(h)}:00</option>
              ))}
            </select>
          </div>
          {/* Minute */}
          <div className="flex-1">
            <div className="text-[10px] text-[#555] mb-1">Minute</div>
            <select
              value={minute}
              onChange={e => setMinute(Number(e.target.value))}
              className="w-full bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-2 text-white text-sm outline-none appearance-none cursor-pointer"
            >
              {minutes.map(m => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

    </div>
  );
}
