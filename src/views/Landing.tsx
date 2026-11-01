"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import GradientASCII from "../components/reactbits/GradientASCII";
import { GoogleIcon } from "../components/Icons";
import { LandingStory } from "../components/LandingStory";
import { useAuth } from "../hooks/useAuth";

export default function Landing() {
  const { ready, authenticated, login } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace("/app");
  }, [ready, authenticated, router]);

  return (
    <main>
      <section className="relative flex min-h-[100vh] flex-col items-center justify-center overflow-hidden bg-[#030712] px-0 py-28">
        <div className="absolute inset-0" aria-hidden>
          <GradientASCII
            colors={["#0b1f6b", "#1e3fd8", "#2f6bff", "#7db4ff"]}
            shape="rise"
            characters=" =+xX0S8#@"
            cellSize={18}
            density={0.8}
          />
          {/* Dims the art behind the words so they stay readable. */}
          <div className="absolute inset-0 [background:radial-gradient(ellipse_55%_45%_at_50%_50%,rgba(3,7,18,.75)_0%,rgba(3,7,18,.4)_55%,rgba(3,7,18,0)_100%)]" />
        </div>
        <div className="rise wrap relative z-10 flex flex-col items-center text-center">
          <div className="cap mb-6 !text-white/60">Spending vaults for AI agents on Arc</div>
          <h1 className="h-display max-w-3xl text-white">Let your agents spend. Approve from your inbox.</h1>
          <p className="lede mt-6 !text-white/70">Your agent pays small amounts on its own. Anything bigger needs one reply from Gmail.</p>
          <div className="mt-8">
            <button className="btn !bg-white !text-[#030712]" disabled={!ready} onClick={() => login()}>
              {ready ? <><GoogleIcon />Sign in with Google</> : "Loading"}
            </button>
          </div>
        </div>
        <div className="wrap relative z-10 mt-14">
          {/* The real approval: the email arrives, the reply is sent, Arc verifies it. */}
          <video
            className="mx-auto block w-full max-w-[860px] rounded-card border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,.6)]"
            autoPlay muted loop playsInline preload="metadata"
            poster="/media/fala/approval-poster.jpg"
            aria-label="An approval email arrives, the reply is sent, and Arc verifies the payment"
          >
            <source src="/media/fala/approval.mp4" type="video/mp4" />
          </video>
        </div>
      </section>
      <LandingStory onStart={login} ready={ready} />
    </main>
  );
}
