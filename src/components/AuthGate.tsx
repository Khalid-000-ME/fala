"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps signed-out visitors out of the app pages without flashing their contents. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);
  if (!ready) return <main className="wrap cap py-32">Loading…</main>;
  if (!authenticated) return <main className="wrap cap py-32">Redirecting to sign in…</main>;
  return <>{children}</>;
}
