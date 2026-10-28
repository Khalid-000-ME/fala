import { useMemo } from "react";
import { useAccount } from "wagmi";
import { DEMO } from "../config/chain";
import { useVaultLogs, useVaultState } from "../hooks/useVaultData";
import { Footer, Header, Toasts, WrongNetwork } from "../components/Chrome";
import { Hero, HowItWorks, Overview } from "../components/Overview";
import { Agents } from "../components/Agents";
import { Activity, Requests } from "../components/Requests";
import { Approve } from "../components/Approve";
import { Forge } from "../components/Forge";

export default function ExplorePage() {
  const { state } = useVaultState();
  const logs = useVaultLogs();
  const { address } = useAccount();
  const owner = !!address && !!state?.owner && address.toLowerCase() === state.owner.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const pending = useMemo(() => logs.intents.filter((i) => i.status === "PENDING" && i.expiresAt > now).length, [logs.intents, now]);

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
        <Hero state={state} pending={pending} />
        <HowItWorks />
        <Overview state={state} intents={logs.intents} owner={owner} />
        <Agents state={state} payees={logs.payees} keys={logs.keys} owner={owner} />
        <Requests intents={logs.intents} ttl={state?.intentTtl ?? 3600} owner={owner} />
        <Activity events={logs.events} loading={logs.loading} />
        <Approve />
        <Forge />
      </main>
      <Footer />
      <Toasts />
    </>
  );
}
