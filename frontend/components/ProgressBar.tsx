interface Props {
  locked: number;
  total: number;
}

export default function ProgressBar({ locked, total }: Props) {
  const pct = total > 0 ? Math.min((locked / total) * 100, 100) : 0;
  return (
    <div className="bg-[#2a2a2a] rounded h-[5px] w-full my-2">
      <div
        className="h-full bg-[#DDE048] rounded transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
