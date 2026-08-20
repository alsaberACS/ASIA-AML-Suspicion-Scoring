// Orval 8 emits zod-v4 API calls (e.g. zod.int()). The workspace zod catalog is
// 3.25.x whose root export is the v3 API, but it ships the full v4 API at the
// `zod/v4` subpath. Point the generated schema file at that subpath.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "..", "api-zod", "src", "generated", "api.ts");

const src = readFileSync(target, "utf8");
const patched = src.replace(
  /from ['"]zod['"]/g,
  "from 'zod/v4'",
);
if (patched !== src) {
  writeFileSync(target, patched);
  console.log("[patch-zod-import] pointed generated zod schemas at zod/v4");
} else {
  console.log("[patch-zod-import] nothing to patch");
}
