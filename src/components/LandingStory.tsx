"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AsciiShape, type ShapeName } from "./AsciiShape";
import { GoogleIcon } from "./Icons";

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ transitionDelay: `${delay}ms` }} className={`transition duration-700 ease-out motion-reduce:transition-none ${seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}>{children}</div>;
}

const CARDS: { shape: ShapeName; title: string; body: string }[] = [
  { shape: "coin", title: "Small spends run alone", body: "Set a limit. Under it, your agent pays saved payees right away." },
  { shape: "envelope", title: "Big ones come to you", body: "Anything above the limit waits for a yes from your Gmail." },
  { shape: "lock", title: "Only you can say yes", body: "Arc checks Google's signature on your reply before money moves." },
];

export function LandingStory({ onStart, ready }: { onStart: () => void; ready: boolean }) {
  return (
    <>
      <section className="wrap grid items-center gap-12 py-24 lg:grid-cols-2 sm:py-32">
        <Reveal>
          <h2 className="h-section">Your day stays yours.</h2>
          <p className="lede mt-6">Your agent works in the background. When it needs a bigger yes, one email shows up with the rest of your mail.</p>
        </Reveal>
        <Reveal className="flex justify-center overflow-hidden" delay={120}><AsciiShape shape="clock" cols={90} rows={44} /></Reveal>
      </section>

      <section className="wrap grid gap-4 pb-24 md:grid-cols-3 sm:pb-32">
        {CARDS.map((c, i) => (
          <Reveal key={c.title} delay={i * 120}>
            <div className="card flex h-full flex-col overflow-hidden !p-0 transition duration-300 hover:-translate-y-1">
              <div className="flex h-64 items-center justify-center overflow-hidden"><AsciiShape shape={c.shape} cols={60} rows={28} speed={0.8 + i * 0.2} /></div>
              <div className="px-7 pb-7">
                <h3 className="text-[22px] tracking-tightest">{c.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-mute">{c.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </section>

      <section className="wrap grid items-center gap-12 pb-24 lg:grid-cols-2 sm:pb-32">
        <Reveal className="order-2 flex justify-center overflow-hidden lg:order-1"><AsciiShape shape="plane" cols={90} rows={44} /></Reveal>
        <Reveal className="order-1 lg:order-2" delay={120}>
          <h2 className="h-section">Tap Approve. Press send.</h2>
          <p className="lede mt-6">No wallet app. No seed phrase. No dashboard to check. Your reply is the key.</p>
          <button className="btn mt-8" disabled={!ready} onClick={() => onStart()}><span className="rounded bg-white p-0.5"><GoogleIcon size={14} /></span>Start with Google</button>
        </Reveal>
      </section>
    </>
  );
}
