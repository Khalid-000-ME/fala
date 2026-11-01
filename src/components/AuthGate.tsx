"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogoLoader } from "./LogoLoader";
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
  if (!ready) return <LogoLoader />;
  if (!authenticated) return <LogoLoader />;
  return <>{children}</>;
}
