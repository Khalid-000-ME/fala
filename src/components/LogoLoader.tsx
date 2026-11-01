const DOTS = [[3, 4], [10, 4], [17, 4], [6.5, 10], [13.5, 10], [10, 16]];

/** The Fala mark with its dots pulsing in sequence. */
export const LogoLoader = () => (
  <div className="flex min-h-[60vh] w-full items-center justify-center text-ink" role="status" aria-label="Loading">
    <svg width="56" height="56" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      {DOTS.map(([cx, cy], i) => <circle key={i} className="logo-dot" cx={cx} cy={cy} r="1.6" style={{ animationDelay: `${i * 0.12}s` }} />)}
    </svg>
  </div>
);
