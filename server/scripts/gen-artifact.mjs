// Copies the compiled FalaVault (abi + creation bytecode) so the server can deploy vaults for users.
import { readFileSync, writeFileSync } from "node:fs";
const a = JSON.parse(readFileSync("../contracts/out/FalaVault.sol/FalaVault.json", "utf8"));
writeFileSync("artifacts/FalaVault.json", JSON.stringify({ abi: a.abi, bytecode: a.bytecode.object }));
console.log("artifact written", a.bytecode.object.length / 2, "bytes");
