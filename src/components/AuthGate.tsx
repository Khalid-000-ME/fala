"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { stallHint, useAuth } from "../hooks/useAuth";

/** Keeps signed-out visitors out of the app pages without flashing their contents. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, stalled, authenticated } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  if (stalled && !ready) {
    return (
      <main className="wrap py-32">
        <h1 className="h-section">Sign-in is not available</h1>
        <p className="lede mt-5">{stallHint()}</p>
        <button className="btn btn-sm mt-8" onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }
  if (!ready) return <main className="wrap cap py-32">Loading…</main>;
  if (!authenticated) return <main className="wrap cap py-32">Redirecting to sign in…</main>;
  return <>{children}</>;
}
