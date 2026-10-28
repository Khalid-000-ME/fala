/** Configure the real-key vault and open one pending request for a real Gmail reply. */
import { addressOf, requestPayment, subjectFor, write } from "../lib/fala.js";
import { vendors } from "../lib/config.js";

await write("owner", "setAgent", [addressOf("agent"), 200_000n, 1_000_000n, 5_000_000n, true]);
await write("owner", "setPayee", [vendors().VENDOR_A, true]);
await write("owner", "setParams", [3 * 86400, 20_000n]); // 3-day TTL so there is time to reply
await write("owner", "deposit", [], 3n * 10n ** 18n);
const r = await requestPayment(vendors().VENDOR_A, "2.00", "real Gmail approval test");
console.log(`pending intent #${r.intentId}  ${r.explorerUrl}`);
console.log(`REPLY SUBJECT (exact): ${await subjectFor(BigInt(r.intentId!), 1)}`);
