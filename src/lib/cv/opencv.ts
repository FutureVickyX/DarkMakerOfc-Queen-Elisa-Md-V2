/**
 * OpenCV.js runtime boundary.
 *
 * OpenCV.js has no complete TypeScript typings for the ArUco module, so the
 * runtime is typed as `CV` (any) here and wrapped by small, typed functions in
 * the CV and segmentation modules. React components never touch OpenCV directly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

/** Resolves the various shapes the Emscripten module can take once loaded. */
export async function resolveCvModule(mod: CV): Promise<CV> {
  if (!mod) throw new Error("OpenCV.js did not load");
  if (mod.Mat) return mod;
  if (typeof mod.then === "function") {
    // Some builds expose a thenable Module; strip `then` after resolution to avoid
    // the well-known infinite-thenable loop.
    const resolved: CV = await new Promise((resolve) => {
      mod.then((m: CV) => {
        if (m && typeof m.then === "function") delete m.then;
        resolve(m);
      });
    });
    if (resolved?.Mat) return resolved;
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out initialising OpenCV.js")), 60_000);
    mod.onRuntimeInitialized = () => {
      clearTimeout(timeout);
      resolve(mod);
    };
  });
}
