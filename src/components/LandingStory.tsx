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

const MAIL = [
  ["Priya", "Notes from today's standup"],
  ["Billing", "Your October invoice"],
  ["Design team", "New mockups are ready"],
  ["Calendar", "Lunch moved to 1:30"],
];

/** A busy inbox: the agent's request lands on top, gets approved, and the day carries on. */
function Inbox() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStep(2);
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 1700);
    return () => clearInterval(t);
  }, []);
  const arrived = step >= 1, approved = step >= 3;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card" aria-label="An inbox with one approval request">
      <div className={`grid transition-all duration-500 ${arrived ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className={`flex items-center justify-between gap-4 border-b border-line px-6 py-5 transition-colors duration-500 ${approved ? "bg-ok/10" : "bg-accent/10"}`}>
            <div className="min-w-0">
              <div className="text-[14px] font-medium">Fala Approvals</div>
              <div className="truncate text-[15px]">Approve <span className="font-mono">1.50</span> USDC for Shopper?</div>
            </div>
            <span className={`shrink-0 rounded-xl px-4 py-2 text-[13px] transition-colors duration-300 ${approved ? "bg-ok/20 text-ok" : step === 2 ? "bg-ink text-canvas" : "border border-line"}`}>{approved ? "Paid" : "Approve"}</span>
          </div>
        </div>
      </div>
      {MAIL.map(([from, subject]) => (
        <div key={from} className="flex gap-6 border-b border-line px-6 py-4 opacity-60 last:border-0">
          <span className="w-28 shrink-0 truncate text-[14px]">{from}</span>
          <span className="cap truncate !text-[14px]">{subject}</span>
        </div>
      ))}
    </div>
  );
}

const CARDS: { shape: ShapeName; title: string; body: string }[] = [
  { shape: "cube", title: "Small spends run alone", body: "Set a limit. Under it, your agent pays saved payees right away." },
  { shape: "blob", title: "Big ones come to you", body: "Anything above the limit waits for a yes from your Gmail." },
  { shape: "ring", title: "Only you can say yes", body: "Arc checks Google's signature on your reply before money moves." },
];

export function LandingStory({ onStart, ready }: { onStart: () => void; ready: boolean }) {
  return (
    <>
      <section className="wrap grid items-center gap-12 py-24 lg:grid-cols-2 sm:py-32">
        <Reveal>
          <h2 className="h-section">Your day stays yours.</h2>
          <p className="lede mt-6">Your agent works in the background. When it needs a bigger yes, one email shows up with the rest of your mail.</p>
        </Reveal>
        <Reveal delay={120}><Inbox /></Reveal>
      </section>

      <section className="wrap grid gap-4 pb-24 md:grid-cols-3 sm:pb-32">
        {CARDS.map((c, i) => (
          <Reveal key={c.title} delay={i * 120}>
            <div className="card flex h-full flex-col overflow-hidden !p-0 transition duration-300 hover:-translate-y-1">
              <div className="flex h-52 items-center justify-center overflow-hidden"><AsciiShape shape={c.shape} cols={38} rows={18} speed={0.8 + i * 0.2} /></div>
              <div className="px-7 pb-7">
                <h3 className="text-[22px] tracking-tightest">{c.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-mute">{c.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </section>

      <section className="wrap grid items-center gap-12 pb-24 lg:grid-cols-2 sm:pb-32">
        <Reveal className="order-2 flex justify-center overflow-hidden lg:order-1"><AsciiShape shape="torus" cols={60} rows={30} /></Reveal>
        <Reveal className="order-1 lg:order-2" delay={120}>
          <h2 className="h-section">Tap Approve. Press send.</h2>
          <p className="lede mt-6">No wallet app. No seed phrase. No dashboard to check. Your reply is the key.</p>
          <button className="btn mt-8" disabled={!ready} onClick={onStart}><span className="rounded bg-white p-0.5"><GoogleIcon size={14} /></span>Start with Google</button>
        </Reveal>
      </section>
    </>
  );
}
