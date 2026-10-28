import { usePrivy } from "@privy-io/react-auth";
import { Link, Navigate } from "react-router-dom";
import { HowItWorks } from "../components/Overview";

const POINTS = [
  ["Your inbox is the second key", "Agents pay small amounts on their own. For anything bigger they email you. Reply from Gmail and Arc verifies Google's signature."],
  ["Bring any agent", "Run our managed agent, plug in Claude, Cursor or anything that speaks MCP or HTTP, or register an agent you already run."],
  ["Your vault, your wallet", "Every vault is owned by your own wallet. Set per-agent limits, a minimum balance and who gets the approval emails."],
] as const;

export default function Landing() {
  const { ready, authenticated, login } = usePrivy();
  if (ready && authenticated) return <Navigate to="/app" replace />;
  return (
    <main>
      <section className="wrap pb-6 pt-14 sm:pt-24">
        <div className="grid items-end gap-12 lg:grid-cols-[1.1fr_.9fr]">
          <div className="rise">
            <div className="cap mb-6">[ Spending vaults for AI agents · Arc ]</div>
            <h1 className="h-display">Let your agents spend. Approve from your inbox.</h1>
            <p className="lede mt-8">Create a vault, connect your agents, and approve anything big with a reply from Gmail. No wallet app, no seed phrase to manage — sign in with Google and you're set.</p>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <button className="btn" disabled={!ready} onClick={() => login()}>Get started with Google</button>
              <Link to="/explore" className="link-accent">See a live vault [ + ]</Link>
            </div>
          </div>
          <div className="tile rise relative aspect-[5/4] w-full overflow-hidden" style={{ animationDelay: ".08s" }}>
            <img src="/media/fala/web/fala-hero-policy-tether.jpg" alt="An agent tethered to a vault" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "58% 50%" }} fetchPriority="high" />
          </div>
        </div>
      </section>
      <section className="wrap py-16">
        <div className="border-t border-line">
          {POINTS.map(([t, d], i) => (
            <div key={t} className="row grid-cols-[2.5rem_minmax(0,1fr)] md:grid-cols-[2.5rem_20rem_minmax(0,1fr)]">
              <span className="cap">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[24px] tracking-tightest">{t}</span>
              <span className="cap col-start-2 mt-1 md:col-start-auto md:mt-0 md:text-[13px]">{d}</span>
            </div>
          ))}
        </div>
      </section>
      <HowItWorks />
    </main>
  );
}
