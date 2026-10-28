import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { BrowserRouter } from "react-router-dom";
import { wagmiConfig } from "./config/wagmi";
import { ACTIVE } from "./config/chain";
import { TxProvider } from "./hooks/useTx";
import App from "./App";
import "./index.css";

const qc = new QueryClient();
const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

function Root() {
  if (!appId) return <div style={{ padding: 40, fontFamily: "monospace" }}>Set VITE_PRIVY_APP_ID in .env to enable sign-in.</div>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google"],
        appearance: { theme: "light", accentColor: "#0a0a0a", logo: undefined },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: ACTIVE,
        supportedChains: [ACTIVE],
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={qc}>
          <TxProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </TxProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
