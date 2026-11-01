"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import GradientASCII from "../components/reactbits/GradientASCII";
import { GoogleIcon } from "../components/Icons";
import { LandingStory } from "../components/LandingStory";
import { useAuth } from "../hooks/useAuth";

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Ease so the hand-off happens gently at both ends. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Widest 16:9 that fits under the 96px title row with a 32px margin below. */
const VIDEO_W = "min(calc(100vw - 40px), 1100px, calc((100vh - 128px) * 16 / 9))";

/** 0 while the hero is untouched, 1 once it has been scrolled through. */
function useScrollProgress() {
  const ref = useRef<HTMLElement>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      setP(total > 0 ? clamp(-el.getBoundingClientRect().top / total) : 0);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  return [ref, p] as const;
}

export default function Landing() {
  const { ready, authenticated, login } = useAuth();
  const router = useRouter();
  const [heroRef, p] = useScrollProgress();
  useEffect(() => {
    if (ready && authenticated) router.replace("/app");
  }, [ready, authenticated, router]);

  const intro = clamp(1 - p / 0.35); // the pitch leaves first
  const compact = ease(clamp((p - 0.35) / 0.3)); // then the short title and button arrive
  const rise = ease(clamp((p - 0.1) / 0.8)); // the video travels throughout
  const signIn = ready ? <><GoogleIcon />Sign in with Google</> : "Loading";

  return (
    <main>
      <section ref={heroRef} className="relative h-[230vh]">
        <div className="sticky top-0 h-screen overflow-hidden bg-[#030712]">
          <div className="absolute inset-0" aria-hidden>
            <GradientASCII
              colors={["#0b1f6b", "#1e3fd8", "#2f6bff", "#7db4ff"]}
              shape="rise"
              characters=" =+xX0S8#@"
              cellSize={18}
              density={0.8}
            />
            {/* Dims the art behind the words, and deepens as the video takes over. */}
            <div
              className="absolute inset-0 [background:radial-gradient(ellipse_60%_50%_at_50%_45%,rgba(3,7,18,.8)_0%,rgba(3,7,18,.45)_55%,rgba(3,7,18,0)_100%)]"
              style={{ opacity: lerp(1, 0.55, rise) }}
            />
          </div>

          {/* The opening pitch sits in the top of the screen so the video can peek in below it. */}
          <div
            className="absolute inset-x-0 top-[13vh] z-20 flex flex-col items-center px-5 text-center"
            style={{ transform: `translateY(${-p * 120}px)`, opacity: intro, pointerEvents: intro < 0.1 ? "none" : "auto" }}
          >
            <div className="cap !text-white/60">Email approvals for AI agents</div>
            <h1 className="mt-5 max-w-5xl font-normal leading-[1.04] tracking-tightest text-white" style={{ fontSize: "min(7vw, 9vh)" }}>Approve your agent's payments from Gmail.</h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-white/70">No wallet app. No dashboard. Your agent emails you, you reply, and it's paid.</p>
            <button className="btn mt-7 !bg-white !text-[#030712]" disabled={!ready} onClick={() => login()}>{signIn}</button>
          </div>

          {/* Title and video share one column, so their edges line up. */}
          <div className="absolute left-1/2 top-0 z-20 flex h-24 -translate-x-1/2 items-center justify-between gap-4" style={{ width: VIDEO_W, opacity: compact, pointerEvents: compact < 0.6 ? "none" : "auto" }}>
            <h2 className="text-[clamp(18px,2.6vw,30px)] leading-tight tracking-tightest text-white">One email. One reply. Paid.</h2>
            <button className="btn shrink-0 !bg-white !text-[#030712]" disabled={!ready} onClick={() => login()}>{signIn}</button>
          </div>

          {/* The recording peeks in at rest and settles fully inside the screen. */}
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2" style={{ width: VIDEO_W }}>
            <div style={{ transform: `translateY(calc(${(1 - rise) * 76}vh + ${rise * 96}px))` }}>
              <video
                className="block w-full rounded-card border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,.6)]"
                autoPlay muted loop playsInline preload="metadata"
                poster="/media/fala/approval-poster.jpg"
                aria-label="An approval email arrives, the reply is sent, and Arc verifies the payment"
              >
                <source src="/media/fala/approval.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>
      </section>
      <LandingStory onStart={login} ready={ready} />
    </main>
  );
}
