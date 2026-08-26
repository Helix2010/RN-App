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
if (operation.parameters?.some((parameter) => parameter.name === "tenant")) {
  console.error(
    "Pinned bootstrap contract still exposes the removed tenant query parameter.",
  );
  process.exit(1);
}
if (!contract.paths?.["/v1/public/releases/{id}/download"]?.get) {
  console.error("Pinned contract does not define release-centric downloads.");
  process.exit(1);
}
for (const [path, method] of [
  ["/v1/mobile/languages/{languageCode}/document", "get"],
  ["/v1/admin/localization", "get"],
  ["/v1/admin/localization/languages", "put"],
  ["/v1/admin/localization/documents", "put"],
  ["/v1/admin/localization/publish", "post"],
]) {
  if (!contract.paths?.[path]?.[method]) {
    console.error(
      `Pinned contract does not define ${method.toUpperCase()} ${path}.`,
    );
    process.exit(1);
  }
}
console.log(
  `RN-Server contract OK: ${contract.info?.version ?? "unknown version"}`,
);
