import { createConfig, http } from "wagmi";
import { ACTIVE } from "./chain";

// Reads only: every write is signed by the user's Privy wallet and broadcast straight to Arc (see lib/owner).
export const wagmiConfig = createConfig({
  chains: [ACTIVE],
  transports: { [ACTIVE.id]: http() } as Record<number, ReturnType<typeof http>>,
});
