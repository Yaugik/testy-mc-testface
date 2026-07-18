import { cp, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/schemas/v1/", import.meta.url), { recursive: true });
await cp(
  new URL("../schemas/v1/scenario.schema.json", import.meta.url),
  new URL("../dist/schemas/v1/scenario.schema.json", import.meta.url),
);
