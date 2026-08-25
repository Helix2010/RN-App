import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractPath = resolve(process.cwd(), "contracts/rn-server.openapi.json");
if (!existsSync(contractPath)) {
  console.error(
    "Missing pinned RN-Server contract. Run the contract sync workflow.",
  );
  process.exit(1);
}

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const operation = contract.paths?.["/v1/mobile/bootstrap"]?.get;
if (!operation?.responses?.["200"]) {
  console.error(
    "Pinned contract does not define GET /v1/mobile/bootstrap with a 200 response.",
  );
  process.exit(1);
}
console.log(
  `RN-Server contract OK: ${contract.info?.version ?? "unknown version"}`,
);
