"use client";

import dynamic from "next/dynamic";
import { LogoLoader } from "../components/LogoLoader";

// Privy and wagmi are browser-only: rendering them on the server breaks the build, so load the tree client-side.
const ProviderTree = dynamic(() => import("./provider-tree"), {
  ssr: false,
  loading: () => <LogoLoader />,
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return <ProviderTree>{children}</ProviderTree>;
}
