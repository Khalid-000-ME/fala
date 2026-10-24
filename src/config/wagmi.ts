import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { ACTIVE } from "./chain";

export const wagmiConfig = createConfig({
  chains: [ACTIVE],
  connectors: [injected()],
  transports: { [ACTIVE.id]: http() } as Record<number, ReturnType<typeof http>>,
});
