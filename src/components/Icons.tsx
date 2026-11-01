"use client";

import type { ReactNode } from "react";
import { FcGoogle } from "react-icons/fc";
import { PiPlugsConnected, PiSparkle, PiTerminalWindow } from "react-icons/pi";
import { SiClaude, SiCursor } from "react-icons/si";
import { TbBrandOpenai } from "react-icons/tb";

export const GoogleIcon = ({ size = 18 }: { size?: number }) => <FcGoogle size={size} aria-hidden />;

const PROVIDER: Record<string, (size: number) => ReactNode> = {
  claude: (s) => <SiClaude size={s} color="#D97757" aria-hidden />,
  chatgpt: (s) => <TbBrandOpenai size={s} aria-hidden />,
  cursor: (s) => <SiCursor size={s} aria-hidden />,
  custom: (s) => <PiPlugsConnected size={s} aria-hidden />,
};
export const ProviderIcon = ({ provider, size = 18 }: { provider?: string | null; size?: number }) => <>{(PROVIDER[provider ?? ""] ?? PROVIDER.custom)(size)}</>;
export const AgentKindIcon = ({ kind, provider, size = 18 }: { kind: string; provider?: string | null; size?: number }) =>
  kind === "managed" ? <PiSparkle size={size} aria-hidden /> : kind === "byo" ? <PiTerminalWindow size={size} aria-hidden /> : <ProviderIcon provider={provider} size={size} />;

/** An amount with its ticker beside it. */
export const Usdc = ({ value, className = "" }: { value: ReactNode; size?: number; className?: string }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
    {value}
    <span className="text-[max(12px,.4em)] tracking-normal text-mute">USDC</span>
  </span>
);
