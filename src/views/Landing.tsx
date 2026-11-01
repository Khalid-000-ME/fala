"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import GradientASCII from "../components/reactbits/GradientASCII";
import { GoogleIcon } from "../components/Icons";
import { useAuth } from "../hooks/useAuth";

const STEPS = [
  ["Your agent asks", "Small payments go through on their own. Bigger ones wait."],
  ["You get an email", "Tap Approve and press send. Nothing else to install."],
  ["Arc checks Google", "The vault verifies Gmail's signature on chain, then pays."],
] as const;

export default function Landing() {
  const { ready, authenticated, login } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace("/app");
  }, [ready, authenticated, router]);

  return (
    <main>
      <section className="relative flex min-h-[100vh] items-center justify-center overflow-hidden bg-[#030712]">
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
          <h1 className="h-display max-w-4xl text-white">Let your agents spend. Approve from your inbox.</h1>
          <p className="lede mt-7 !text-white/70">Your agent pays small amounts on its own. Anything bigger needs one reply from Gmail.</p>
          <div className="mt-9">
            <button className="btn !bg-white !text-[#030712]" disabled={!ready} onClick={() => login()}>
              {ready ? <><GoogleIcon />Sign in with Google</> : "Loading"}
            </button>
          </div>
        </div>
      </section>

      <section className="wrap py-20 sm:py-28">
        <ol className="grid gap-10 sm:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <div className="cap">{String(i + 1).padStart(2, "0")}</div>
              <h2 className="mt-3 text-[24px] tracking-tightest">{title}</h2>
              <p className="cap mt-2 md:text-[13px]">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
