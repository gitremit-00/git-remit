interface Props {
  locked: number;
  total: number;
  color?: string;
}

export default function ProgressBar({ locked, total, color = "#DDE048" }: Props) {
  const pct = total > 0 ? Math.min((locked / total) * 100, 100) : 0;
  return (
    <div className="bg-[#2a2a2a] rounded h-[5px] w-full my-2">
      <div
        className="h-full rounded transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
