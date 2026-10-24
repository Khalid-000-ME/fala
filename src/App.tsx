import { useMemo } from "react";
import { useAccount } from "wagmi";
import { DEMO } from "./config/chain";
import { derivePending, protectedAmount, useVaultEvents, useVaultState } from "./hooks/useVaultData";
import { Footer, Header, Toasts, WrongNetwork } from "./components/Chrome";
import { Hero, Overview } from "./components/Overview";
import { Agents } from "./components/Agents";
import { Activity, Pending, Scoreboard } from "./components/Feed";
import { Simulator } from "./components/Simulator";

export default function App() {
  const { state } = useVaultState();
  const { events, loading } = useVaultEvents();
  useAccount();
  const pending = useMemo(() => derivePending(events), [events]);
  const protectedAmt = useMemo(() => protectedAmount(events), [events]);
  const executedToday = useMemo(() => {
    const day = Math.floor(Date.now() / 1000 / 86400);
    return events.filter((e) => e.kind === "executed" && Math.floor(e.ts / 86400) === day).reduce((s, e) => s + (e.amount ?? 0n), 0n);
  }, [events]);

  return (
    <>
      <WrongNetwork />
      <Header />
      {DEMO && (
        <div className="bg-card">
          <div className="wrap py-2.5 font-mono text-[12.5px] text-mute">
            [ demo data ] No vault configured — set <span className="text-ink">VITE_VAULT_ADDRESS</span> to go live. Writes are disabled.
          </div>
        </div>
      )}
      <main>
        <Hero state={state} protectedAmt={protectedAmt} />
        <Overview state={state} pendingCount={pending.length} executedToday={executedToday} />
        <Agents state={state} />
        <Pending rows={pending} agents={state?.agents ?? []} ttl={state?.pendingTtl ?? 3600} owner={state?.owner} />
        <Activity events={events} loading={loading} />
        <Scoreboard events={events} protectedAmt={protectedAmt} />
        <Simulator agents={state?.agents ?? []} />
      </main>
      <Footer />
      <Toasts />
    </>
  );
}
