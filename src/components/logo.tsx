// Wordmark + mark for "PAY SCOPE" — a crosshair/scope ring stands in for
// "watching spend closely", paired with a plain-spoken wordmark so it reads
// as a finance tool, not a camera app. Pure inline SVG: no external asset,
// no font dependency, renders identically everywhere including RTL.
// Palette is purple/black/white per the owner's explicit request.
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="34" height="34" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="pay-scope-mark" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#0a0a0a" />
          </linearGradient>
        </defs>
        <rect width="26" height="26" rx="7" fill="url(#pay-scope-mark)" />
        <circle cx="13" cy="13" r="6.5" stroke="white" strokeWidth="1.6" />
        <circle cx="13" cy="13" r="1.6" fill="white" />
        <path d="M13 4.2V7M13 19v2.8M4.2 13H7M19 13h2.8" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="flex items-baseline gap-1 leading-none" dir="ltr">
        <span className="text-[20px] font-bold tracking-tight text-stone-50">PAY</span>
        <span className="text-[20px] font-medium tracking-tight text-purple-400">SCOPE</span>
      </span>
    </span>
  );
}
