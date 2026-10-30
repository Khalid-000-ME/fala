"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

/** Privy stays unready forever when the origin is missing from its allowed domains, so stop waiting and say so. */
const STALL_MS = 8000;

export function useAuth() {
  const privy = usePrivy();
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (privy.ready) return setStalled(false);
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [privy.ready]);
  return { ...privy, stalled };
}

/** Explains the one failure that actually causes a stall, with the origin to paste into Privy. */
export function stallHint() {
  const origin = typeof window === "undefined" ? "this app's origin" : window.location.origin;
  return `Sign-in could not start. Add ${origin} to your Privy app's allowed domains.`;
}
