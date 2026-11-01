"use client";

import type { ReactNode } from "react";
import { FcGoogle } from "react-icons/fc";
import { LuBot, LuKeyRound, LuPlug } from "react-icons/lu";
import { SiClaude, SiCursor, SiGmail } from "react-icons/si";
import { TbBrandOpenai } from "react-icons/tb";
import { TokenUSDC } from "@web3icons/react";

export const GoogleIcon = ({ size = 18 }: { size?: number }) => <FcGoogle size={size} aria-hidden />;
export const GmailIcon = ({ size = 16 }: { size?: number }) => <SiGmail size={size} color="#EA4335" aria-hidden />;
export const UsdcIcon = ({ size = 18 }: { size?: number }) => <TokenUSDC variant="branded" size={size} aria-hidden />;

const PROVIDER: Record<string, (size: number) => ReactNode> = {
  claude: (s) => <SiClaude size={s} color="#D97757" aria-hidden />,
  chatgpt: (s) => <TbBrandOpenai size={s} aria-hidden />,
  cursor: (s) => <SiCursor size={s} aria-hidden />,
  custom: (s) => <LuPlug size={s} aria-hidden />,
};
export const ProviderIcon = ({ provider, size = 18 }: { provider?: string | null; size?: number }) => <>{(PROVIDER[provider ?? ""] ?? PROVIDER.custom)(size)}</>;
export const AgentKindIcon = ({ kind, provider, size = 18 }: { kind: string; provider?: string | null; size?: number }) =>
  kind === "managed" ? <LuBot size={size} aria-hidden /> : kind === "byo" ? <LuKeyRound size={size} aria-hidden /> : <ProviderIcon provider={provider} size={size} />;

/** An amount with the USDC mark and ticker beside it. */
export const Usdc = ({ value, size = 16, className = "" }: { value: ReactNode; size?: number; className?: string }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
    {value}
    <UsdcIcon size={size} />
    <span className="text-[max(12px,.4em)] tracking-normal text-mute">USDC</span>
  </span>
);
