// Copies the OpenCV.js build into public/vendor so the browser worker can load it
// as a static asset instead of bundling ~10 MB of WASM-in-JS into the app chunks.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let source;
try {
  source = require.resolve("@techstark/opencv-js/dist/opencv.js");
} catch {
  console.warn("[copy-opencv] @techstark/opencv-js is not installed yet; skipping.");
  process.exit(0);
}

const targetDir = join(root, "public", "vendor");
if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, "opencv.js"));
console.log("[copy-opencv] copied opencv.js to public/vendor/");
