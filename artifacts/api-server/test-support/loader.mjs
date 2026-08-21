import { register } from "node:module";

// Registers the .ts specifier resolver on a loader thread so `node
// --experimental-strip-types --test` can execute source modules that use
// extensionless relative imports (the tsc/esbuild convention in this repo).
register(new URL("./resolve-ts.mjs", import.meta.url));
