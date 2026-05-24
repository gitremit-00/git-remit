"use client";
import Image from "next/image";

export default function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0c10]">
      <div className="relative flex items-center justify-center">
        {/* Spinning ring */}
        <svg
          className="absolute"
          width="96"
          height="96"
          viewBox="0 0 96 96"
          style={{ animation: "spin 1.2s linear infinite" }}
        >
          <circle
            cx="48"
            cy="48"
            r="44"
            fill="none"
            stroke="#DDE048"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="60 220"
          />
        </svg>
        {/* Logo */}
        <Image
          src="/logo.png"
          alt="RemitSafe"
          width={48}
          height={48}
          style={{ objectFit: "contain", opacity: 0.9 }}
        />
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
