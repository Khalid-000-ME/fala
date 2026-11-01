"use client";

import { PrivyProvider, addRpcUrlOverrideToChain } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { ACTIVE } from "../config/chain";
import { wagmiConfig } from "../config/wagmi";
import { TxProvider } from "../hooks/useTx";
import { Toasts } from "../components/Chrome";
import { PlatformFooter, PlatformHeader } from "../components/PlatformChrome";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
// Privy routes embedded-wallet RPC through its own providers, which do not serve Arc. Pin it to Arc's RPC.
const PRIVY_CHAIN = addRpcUrlOverrideToChain(ACTIVE, ACTIVE.rpcUrls.default.http[0]);

export default function ProviderTree({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  if (!appId) {
    return <main className="wrap py-24 text-[13px]">Set NEXT_PUBLIC_PRIVY_APP_ID in .env.local to enable sign-in.</main>;
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google"],
        appearance: { theme: "light", accentColor: "#0a0a0a" },
        // Privy's confirmation modal prices gas through its own RPC, which does not serve Arc and fails there.
        // We sign headlessly and show our own confirmation instead (requires "Enforce wallet UIs" off in the Privy dashboard).
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: PRIVY_CHAIN,
        supportedChains: [PRIVY_CHAIN],
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={qc}>
          <TxProvider>
            <PlatformHeader />
            {children}
            <PlatformFooter />
            <Toasts />
          </TxProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}
