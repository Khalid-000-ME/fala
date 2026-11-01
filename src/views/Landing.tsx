"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import GradientASCII from "../components/reactbits/GradientASCII";
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
      <section className="relative flex min-h-[92vh] items-center justify-center overflow-hidden">
        <div className="absolute inset-0" aria-hidden>
          <GradientASCII
            lightMode
            colors={["#e8527a", "#7a5cff", "#1e3fd8", "#0a0a0a"]}
            shape="horizon"
            cellSize={14}
            glyphOpacity={1}
            gradientOpacity={1}
            speed={0.7}
            grain={0.06}
          />
          {/* A soft pool of white behind the words only, so the art still reads at the edges. */}
          <div className="absolute inset-0 [background:radial-gradient(ellipse_52%_46%_at_50%_50%,rgba(255,255,255,.92)_0%,rgba(255,255,255,.72)_45%,rgba(255,255,255,0)_100%)]" />
        </div>
        <div className="rise wrap relative z-10 flex flex-col items-center text-center">
          <div className="cap mb-6">Spending vaults for AI agents on Arc</div>
          <h1 className="h-display max-w-4xl">Let your agents spend. Approve from your inbox.</h1>
          <p className="lede mt-7">Your agent pays small amounts on its own. Anything bigger needs one reply from Gmail.</p>
          <div className="mt-9">
            <button className="btn" disabled={!ready} onClick={() => login()}>
              {ready ? "Sign in with Google" : "Loading"}
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
