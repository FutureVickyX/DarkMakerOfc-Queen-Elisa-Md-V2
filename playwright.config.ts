import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use a preinstalled Chromium when available (CI images / sandboxes); otherwise Playwright's own.
const preinstalled = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", process.env.PLAYWRIGHT_CHROMIUM_PATH ?? ""].find((p) => p && existsSync(p));
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: preinstalled ? { executablePath: preinstalled } : {},
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Force local mode for E2E regardless of developer env.
    env: { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
  },
});
