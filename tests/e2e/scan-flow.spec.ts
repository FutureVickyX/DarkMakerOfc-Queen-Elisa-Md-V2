import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_DIR } from "./global-setup";

const meta = () => JSON.parse(readFileSync(join(FIXTURE_DIR, "calibrated.json"), "utf8")) as {
  width: number;
  height: number;
  nailCentre: { x: number; y: number };
};

async function createScan(page: Page, name: string) {
  await page.goto("/scan/new");
  await page.getByLabel("Scan name").fill(name);
  await page.getByRole("button", { name: "Create scan and add a photo" }).click();
  await expect(page.getByRole("heading", { name: "Add a photo" })).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}

async function upload(page: Page, file: string) {
  await page.getByLabel("Choose a photo").setInputFiles(join(FIXTURE_DIR, file));
}

/** Clicks the viewport at an image-space coordinate. */
async function clickImage(page: Page, p: { x: number; y: number }, size: { width: number; height: number }) {
  const img = page.locator('[role="application"] img');
  const box = (await img.boundingBox())!;
  await page.mouse.click(box.x + ((p.x + 0.5) / size.width) * box.width, box.y + ((p.y + 0.5) / size.height) * box.height);
}

test("calibrates a synthetic photo, measures a drawn nail, confirms and exports", async ({ page }) => {
  const m = meta();
  await createScan(page, "E2E calibrated");
  await upload(page, "calibrated.png");

  await expect(page).toHaveURL(/\/capture\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText("✓ Calibrated").first()).toBeVisible();

  // Draw a manual outline at the nail centre, then confirm it.
  await page.getByRole("button", { name: "Draw outline" }).click();
  await clickImage(page, m.nailCentre, m);
  await expect(page.getByText("Selected nail")).toBeVisible();
  await expect(page.getByText("Manual outline").first()).toBeVisible();

  await page.getByLabel("Hand", { exact: true }).selectOption("left");
  await page.getByLabel("Finger", { exact: true }).selectOption("index");
  await page.getByRole("button", { name: "Confirm measurement" }).click();
  await expect(page.getByText("Confirmed").first()).toBeVisible();

  await page.getByRole("link", { name: "Ten-nail profile" }).click();
  const row = page.getByRole("row", { name: /Left index finger/ });
  await expect(row.getByText("Measured")).toBeVisible();
  await expect(page.getByRole("row", { name: /Right thumb/ }).getByText("Incomplete")).toBeVisible();

  await page.getByRole("link", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.split("\r\n")[0]).toContain("width_mm");
  const left = csv.split("\r\n").find((l) => l.startsWith("left,index"))!;
  expect(left).toContain("measured");
  expect(csv).toContain("left,thumb,incomplete");

  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF report" }).click()]);
  expect(readFileSync((await pdf.path())!).subarray(0, 4).toString()).toBe("%PDF");
});

test("experimental tap-to-outline finds a contrasting nail within 0.5 mm", async ({ page }) => {
  const m = meta();
  await createScan(page, "E2E tap");
  await upload(page, "calibrated.png");
  await expect(page.getByText("✓ Calibrated").first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Tap to outline" }).click();
  await clickImage(page, m.nailCentre, m);
  await expect(page.getByText("Selected nail")).toBeVisible({ timeout: 60_000 });
  const width = await page.locator("dt:text('Width') + dd").first().innerText();
  const length = await page.locator("dt:text('Length') + dd").first().innerText();
  expect(Math.abs(parseFloat(width) - 14)).toBeLessThan(0.5);
  expect(Math.abs(parseFloat(length) - 12)).toBeLessThan(0.5);
  await expect(page.getByText(/confidence n\/a/).first()).toBeVisible();
});

test("rejects calibration when markers are missing and produces no millimetres", async ({ page }) => {
  await createScan(page, "E2E no markers");
  await upload(page, "no-markers.png");
  await expect(page.getByText("✕ Calibration failed").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Physical scale could not be established.")).toBeVisible();
  await expect(page.getByText(/Found 0 of 4 calibration markers/)).toBeVisible();
});

test("rejects an invalid image file", async ({ page }) => {
  await createScan(page, "E2E invalid");
  await upload(page, "not-an-image.png");
  await expect(page.getByText("Could not use this photo")).toBeVisible({ timeout: 30_000 });
});
