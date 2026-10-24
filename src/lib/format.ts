import { formatUnits, parseUnits } from "viem";
import { USDC_DECIMALS } from "../config/chain";

export const fmtUsdc = (v: bigint | number | undefined, dp = 2) => {
  if (v === undefined) return "—";
  const s = formatUnits(BigInt(v), USDC_DECIMALS);
  const [i, f = ""] = s.split(".");
  const frac = f.padEnd(dp, "0").slice(0, dp);
  return `${Number(i).toLocaleString("en-US")}${dp ? "." + frac : ""}`;
};
export const parseUsdc = (s: string) => parseUnits(s || "0", USDC_DECIMALS);
export const short = (a?: string, n = 4) => (a ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : "—");

export const ago = (ts: number, now = Date.now() / 1000) => {
  const d = Math.max(0, Math.floor(now - ts));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
export const countdown = (secs: number) => {
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
