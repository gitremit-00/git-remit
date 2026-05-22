"use client";
import Image from "next/image";

export default function LoadingSpinner({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center ${fullScreen ? "min-h-screen bg-[#0a0c10]" : "py-12"}`}>
      <div className="relative flex items-center justify-center">
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          style={{ animation: "spin 1.2s linear infinite" }}
        >
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke="#DDE048"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="36 120"
          />
        </svg>
        <Image
          src="/logo.png"
          alt=""
          width={26}
          height={26}
          className="absolute"
          style={{ objectFit: "contain", opacity: 0.9 }}
        />
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
