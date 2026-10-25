import { formatUnits, parseUnits } from "viem";

/** USDC ERC-20 view: 6 decimals. */
export const toUsdc6 = (s: string | number) => parseUnits(String(s), 6);
export const fromUsdc6 = (v: bigint) => formatUnits(v, 6);
