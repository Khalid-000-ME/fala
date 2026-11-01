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

  const e = ease(p);
  const intro = clamp(1 - p / 0.42);       // the big centred block fades out first
  const compact = ease(clamp((p - 0.4) / 0.35)); // then the small title and button fade in
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
              style={{ opacity: lerp(1, 0.55, e) }}
            />
          </div>

          {/* The opening pitch, centred. */}
          <div
            className="absolute inset-x-0 top-1/2 z-20 flex flex-col items-center px-5 text-center"
            style={{ transform: `translateY(calc(-50% - ${e * 110}px)) scale(${lerp(1, 0.82, e)})`, opacity: intro, pointerEvents: intro < 0.1 ? "none" : "auto" }}
          >
            <div className="cap mb-6 !text-white/60">Spending vaults for AI agents on Arc</div>
            <h1 className="h-display max-w-3xl text-white">Let your agents spend. Approve from your inbox.</h1>
            <p className="lede mt-6 !text-white/70">Your agent pays small amounts on its own. Anything bigger needs one reply from Gmail.</p>
            <div className="mt-8">
              <button className="btn !bg-white !text-[#030712]" disabled={!ready} onClick={() => login()}>{signIn}</button>
            </div>
          </div>

          {/* Once scrolled, the title shrinks to a line with the button beside it. */}
          <div
            className="absolute inset-x-0 top-0 z-20 pt-7"
            style={{ opacity: compact, transform: `translateY(${(1 - compact) * -18}px)`, pointerEvents: compact < 0.6 ? "none" : "auto" }}
          >
            <div className="wrap flex items-center justify-between gap-6">
              <h2 className="text-[clamp(19px,3.2vw,34px)] leading-tight tracking-tightest text-white">Watch approving your agent</h2>
              <button className="btn shrink-0 !bg-white !text-[#030712]" disabled={!ready} onClick={() => login()}>{signIn}</button>
            </div>
          </div>

          {/* The recording rises into view as the words recede. */}
          <div
            className="absolute inset-x-0 top-0 z-10 flex justify-center px-5"
            style={{ transform: `translateY(${lerp(68, 17, e)}vh) scale(${lerp(0.94, 1, e)})` }}
          >
            <video
              className="block w-full max-w-[900px] rounded-card border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,.6)]"
              autoPlay muted loop playsInline preload="metadata"
              poster="/media/fala/approval-poster.jpg"
              aria-label="An approval email arrives, the reply is sent, and Arc verifies the payment"
            >
              <source src="/media/fala/approval.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      </section>
      <LandingStory onStart={login} ready={ready} />
    </main>
  );
}
