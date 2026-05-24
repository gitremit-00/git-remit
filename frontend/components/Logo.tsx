import Image from "next/image";

export default function Logo({ height = 36 }: { height?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/logo.png"
        alt="RemitSafe icon"
        width={height}
        height={height}
        priority
        style={{ objectFit: "contain" }}
      />
      <Image
        src="/remitsafe.png"
        alt="RemitSafe"
        width={110}
        height={height}
        priority
        style={{ objectFit: "contain" }}
      />
    </div>
  );
}
