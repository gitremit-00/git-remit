"use client";

interface Props {
  score: number;
  max?: number;
  size?: number;
}

export default function CircularScore({ score, max = 100, size = 72 }: Props) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / max) * circ;
  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e2a3a" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#5BB7FF" strokeWidth="6"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fill="#fff" fontSize={size * 0.22} fontWeight="700">{score}</text>
        <text x={size / 2} y={size / 2 + size * 0.18} textAnchor="middle" fill="#888" fontSize={size * 0.13}>/ {max}</text>
      </svg>
    </div>
  );
}
