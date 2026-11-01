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
  ["P", "#7c4dff", "Priya", "Standup notes", "Three things from today", "2:41 PM"],
  ["B", "#00897b", "Billing", "Your October invoice", "Your statement is ready", "1:15 PM"],
  ["D", "#e8710a", "Design team", "New mockups", "Take a look when free", "11:02 AM"],
];

const Avatar = ({ c, bg }: { c: string; bg: string }) => <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] text-white" style={{ background: bg }}>{c}</span>;

function Row({ c, bg, from, subject, snippet, time, unread, fresh }: { c: string; bg: string; from: string; subject: string; snippet: string; time: string; unread?: boolean; fresh?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${fresh ? "mail-in bg-[#eaf1fb]" : ""}`}>
      <Avatar c={c} bg={bg} />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-3 text-[14px]"><span className={unread ? "font-semibold" : ""}>{from}</span><span className={`text-[12px] ${unread ? "font-semibold" : "text-[#5f6368]"}`}>{time}</span></div>
        <div className={`truncate text-[14px] ${unread ? "font-semibold" : ""}`}>{subject}</div>
        <div className="truncate text-[13px] text-[#5f6368]">{snippet}</div>
      </div>
    </div>
  );
}

/** A phone mail app: request arrives, opens, gets approved, is sent, and the receipt lands. */
const STEPS = ["list", "arrive", "open", "tap", "reply", "sent", "paid"] as const;
function Inbox() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setI(2);
    const t = setInterval(() => setI((n) => (n + 1) % STEPS.length), 1800);
    return () => clearInterval(t);
  }, []);
  const step = STEPS[i];
  const reading = step === "open" || step === "tap";
  return (
    <div className="relative mx-auto h-[460px] w-full max-w-[400px] overflow-hidden rounded-[28px] border-[6px] border-line bg-white text-[#202124] shadow-2xl" aria-label="A mail app receiving and approving a Fala request">
      {reading ? (
        <div key="read" className="mail-open p-5">
          <div className="text-[19px]">Approve 1.50 USDC to 0xFA1a…451c?</div>
          <div className="mt-4 flex items-center gap-3"><Avatar c="F" bg="#0b57d0" /><div><div className="text-[14px] font-semibold">Fala Approvals</div><div className="text-[12px] text-[#5f6368]">to me</div></div></div>
          <div className="mt-5 rounded-2xl bg-[#f6f8fc] p-4 text-[14px]">
            <div>Shopper wants to pay for</div>
            <div className="mt-1 font-semibold">Blue running shoes</div>
            <div className="mt-4 flex gap-2">
              <span className={`relative overflow-hidden rounded-xl bg-[#0b57d0] px-4 py-2 text-[13px] text-white transition ${step === "tap" ? "scale-95" : ""}`}>Approve{step === "tap" && <i className="mail-ripple" />}</span>
              <span className="rounded-xl border border-[#c4c7c5] px-4 py-2 text-[13px]">Deny</span>
            </div>
          </div>
        </div>
      ) : step === "reply" ? (
        <div key="reply" className="mail-open p-5">
          <div className="flex items-center justify-between"><span className="text-[16px]">Reply</span><span className="rounded-full bg-[#0b57d0] px-5 py-2 text-[13px] text-white mail-pulse">Send</span></div>
          <div className="mt-5 border-b border-[#e0e0e0] pb-2 text-[13px] text-[#5f6368]">To Fala Approvals</div>
          <div className="border-b border-[#e0e0e0] py-2 text-[13px]">FALA APPROVE 1 3b0142b1</div>
          <div className="mt-3 text-[14px]">Yes, please go ahead.</div>
        </div>
      ) : (
        <div key="list">
          <div className="m-3 rounded-full bg-[#eaf1fb] px-4 py-2.5 text-[14px] text-[#5f6368]">Search in mail</div>
          <div className="px-4 pb-1 text-[12px] text-[#5f6368]">Primary</div>
          {step === "paid" && <Row fresh unread c="F" bg="#0b57d0" from="Fala Approvals" subject="Payment sent: 1.50 USDC" snippet="Verified on Arc" time="now" />}
          {(step === "arrive") && <Row fresh unread c="F" bg="#0b57d0" from="Fala Approvals" subject="Approve 1.50 USDC to 0xFA1a…451c?" snippet="Shopper is waiting for you" time="now" />}
          {MAIL.map(([c, bg, from, subject, snippet, time]) => <Row key={from} c={c} bg={bg} from={from} subject={subject} snippet={snippet} time={time} />)}
          {step === "sent" && <div className="mail-in absolute inset-x-3 bottom-3 rounded-lg bg-[#323232] px-4 py-3 text-[14px] text-white">Message sent</div>}
        </div>
      )}
    </div>
  );
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
        <Reveal className="order-2 flex justify-center overflow-hidden lg:order-1"><AsciiShape shape="plane" cols={60} rows={30} /></Reveal>
        <Reveal className="order-1 lg:order-2" delay={120}>
          <h2 className="h-section">Tap Approve. Press send.</h2>
          <p className="lede mt-6">No wallet app. No seed phrase. No dashboard to check. Your reply is the key.</p>
          <button className="btn mt-8" disabled={!ready} onClick={() => onStart()}><span className="rounded bg-white p-0.5"><GoogleIcon size={14} /></span>Start with Google</button>
        </Reveal>
      </section>
    </>
  );
}
