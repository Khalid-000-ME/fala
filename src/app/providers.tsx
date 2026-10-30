"use client";

import dynamic from "next/dynamic";

// Privy and wagmi are browser-only: rendering them on the server breaks the build, so load the tree client-side.
const ProviderTree = dynamic(() => import("./provider-tree"), {
  ssr: false,
  loading: () => <div className="wrap cap py-32">Loading…</div>,
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return <ProviderTree>{children}</ProviderTree>;
}
