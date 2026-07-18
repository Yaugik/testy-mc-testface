import { cp, mkdir, rm } from "node:fs/promises";

const source = new URL("../schemas", import.meta.url);
const destination = new URL("../dist/schemas", import.meta.url);

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
