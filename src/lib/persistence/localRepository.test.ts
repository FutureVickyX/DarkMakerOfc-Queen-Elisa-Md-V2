import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { scanWithNail } from "../../../tests/helpers/fixtures";
import { LocalScanRepository } from "./localRepository";

describe("LocalScanRepository", () => {
  it("saves, lists, reopens and deletes scans with their images", async () => {
    const repo = new LocalScanRepository(`test-${Math.random()}`);
    const scan = scanWithNail();
    await repo.saveScan(scan);
    const assetId = await repo.putImage(scan.id, scan.captures[0]!.id, new Blob(["x"], { type: "image/jpeg" }));
    expect(await repo.getImage(assetId)).not.toBeNull();

    const list = await repo.listScans();
    expect(list).toHaveLength(1);
    expect(list[0]!.captureCount).toBe(1);
    expect((await repo.getScan(scan.id))!.nails[0]!.measurement!.widthMm).toBeCloseTo(14, 1);

    await repo.deleteScan(scan.id);
    expect(await repo.getScan(scan.id)).toBeNull();
    expect(await repo.getImage(assetId)).toBeNull();
  });

  it("unlinks scans when a customer is deleted", async () => {
    const repo = new LocalScanRepository(`test-${Math.random()}`);
    await repo.saveCustomer({ id: "c1", customerReference: "Order 7", createdAt: "2026-01-01T00:00:00Z" });
    const scan = { ...scanWithNail(), customerId: "c1" };
    await repo.saveScan(scan);
    await repo.deleteCustomer("c1");
    expect(await repo.listCustomers()).toHaveLength(0);
    expect((await repo.getScan(scan.id))!.customerId).toBeNull();
  });
});
