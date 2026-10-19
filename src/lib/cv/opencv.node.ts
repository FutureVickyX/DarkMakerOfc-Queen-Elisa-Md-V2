import { resolveCvModule, type CV } from "./opencv";

let pending: Promise<CV> | null = null;

/** Node / test loader. */
export function loadOpenCvNode(): Promise<CV> {
  if (!pending) {
    pending = (async () => {
      // Use require rather than `await import()`: the Emscripten module object exposes a
      // `then` method, which makes a dynamic-import namespace look like a thenable and hang.
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const mod = require("@techstark/opencv-js") as CV;
      return resolveCvModule(mod);
    })();
  }
  return pending;
}
