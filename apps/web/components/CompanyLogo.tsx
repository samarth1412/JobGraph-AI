"use client";

import { useEffect, useState } from "react";

type Props = {
  name: string;
  logoUrl?: string | null;
  sizeClass?: string;
  className?: string;
  index?: number;
};

const FALLBACK_PALETTES = [
  "bg-zinc-900 text-zinc-100",
  "bg-[#6d4ab8] text-white",
  "bg-teal-700 text-white",
  "bg-rose-700 text-white",
  "bg-slate-700 text-white",
  "bg-zinc-200 text-zinc-900",
];

/** Letter size scales with avatar dimensions from `sizeClass`. */
function letterTextClass(sizeClass: string) {
  if (sizeClass.includes("h-20") || sizeClass.includes("h-16")) return "text-2xl font-semibold tracking-tight";
  if (sizeClass.includes("h-14")) return "text-xl font-semibold tracking-tight";
  return "text-sm font-semibold tracking-tight";
}

export function CompanyLogo({ name, logoUrl, sizeClass = "h-10 w-10", className = "", index = 0 }: Props) {
  const url = (logoUrl || "").trim();
  const [showImage, setShowImage] = useState(false);
  const letter = (name || "J").trim().slice(0, 1).toUpperCase() || "J";
  const palette = FALLBACK_PALETTES[Math.abs(index) % FALLBACK_PALETTES.length];
  const letterCls = letterTextClass(sizeClass);

  useEffect(() => {
    setShowImage(false);
  }, [url]);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/10 ${palette} ${sizeClass} ${className}`}
      aria-hidden
    >
      <span
        className={`absolute inset-0 z-0 flex items-center justify-center pointer-events-none select-none ${letterCls}`}
      >
        {letter}
      </span>
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`absolute inset-0 z-10 h-full w-full bg-white object-contain p-1 transition-opacity duration-200 ${showImage ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setShowImage(true)}
          onError={() => setShowImage(false)}
        />
      ) : null}
    </div>
  );
}
