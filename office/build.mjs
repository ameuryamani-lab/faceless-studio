// Bundles office/src into office/public/app.js and app.css with esbuild's JS API (the copy in the studio's
// node_modules, no install). Run: node office/build.mjs   (add --watch to rebuild on save).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const esbuild = require(join(here, "..", "node_modules", "esbuild"));
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [join(here, "src", "main.tsx")],
  outfile: join(here, "public", "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome110", "firefox110", "safari16"],
  jsx: "automatic",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"' },
  nodePaths: [join(here, "..", "node_modules")],
  logLevel: "info",
};

try {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("Watching office/src …");
  } else {
    await esbuild.build(options);
  }
} catch (err) {
  console.error("Build failed:", err?.message ?? err);
  process.exit(1);
}
