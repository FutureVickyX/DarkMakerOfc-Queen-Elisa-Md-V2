import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Customer, Scan, ScanSummary } from "@/lib/scan/model";
import { summarize } from "@/lib/scan/scanService";
import type { ScanRepository } from "./scanRepository";

interface NailMeasureDB extends DBSchema {
  scans: { key: string; value: Scan; indexes: { by_updated: string; by_customer: string } };
  images: { key: string; value: { id: string; scanId: string; blob: Blob; createdAt: string }; indexes: { by_scan: string } };
  customers: { key: string; value: Customer };
}

const DB_NAME = "nailmeasure";
const DB_VERSION = 1;

/**
 * Local-only persistence in the browser's IndexedDB. Nothing leaves the device.
 * Used automatically when Supabase is not configured.
 */
export class LocalScanRepository implements ScanRepository {
  readonly mode = "local" as const;
  readonly storesImages = true;
  private db: Promise<IDBPDatabase<NailMeasureDB>>;

  constructor(dbName = DB_NAME) {
    this.db = openDB<NailMeasureDB>(dbName, DB_VERSION, {
      upgrade(db) {
        const scans = db.createObjectStore("scans", { keyPath: "id" });
        scans.createIndex("by_updated", "updatedAt");
        scans.createIndex("by_customer", "customerId");
        const images = db.createObjectStore("images", { keyPath: "id" });
        images.createIndex("by_scan", "scanId");
        db.createObjectStore("customers", { keyPath: "id" });
      },
    });
  }

  async listScans(): Promise<ScanSummary[]> {
    const all = await (await this.db).getAll("scans");
    return all.map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getScan(id: string): Promise<Scan | null> {
    return (await (await this.db).get("scans", id)) ?? null;
  }

  async saveScan(scan: Scan): Promise<Scan> {
    await (await this.db).put("scans", scan);
    return scan;
  }

  async deleteScan(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(["scans", "images"], "readwrite");
    const imageKeys = await tx.objectStore("images").index("by_scan").getAllKeys(id);
    await Promise.all([...imageKeys.map((k) => tx.objectStore("images").delete(k)), tx.objectStore("scans").delete(id)]);
    await tx.done;
  }

  async putImage(scanId: string, captureId: string, blob: Blob): Promise<string> {
    const id = `${scanId}/${captureId}`;
    await (await this.db).put("images", { id, scanId, blob, createdAt: new Date().toISOString() });
    return id;
  }

  async getImage(assetId: string): Promise<Blob | null> {
    return (await (await this.db).get("images", assetId))?.blob ?? null;
  }

  async deleteImage(assetId: string): Promise<void> {
    await (await this.db).delete("images", assetId);
  }

  async listCustomers(): Promise<Customer[]> {
    const all = await (await this.db).getAll("customers");
    return all.sort((a, b) => a.customerReference.localeCompare(b.customerReference));
  }

  async getCustomer(id: string): Promise<Customer | null> {
    return (await (await this.db).get("customers", id)) ?? null;
  }

  async saveCustomer(customer: Customer): Promise<Customer> {
    await (await this.db).put("customers", customer);
    return customer;
  }

  async deleteCustomer(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(["customers", "scans"], "readwrite");
    const scans = await tx.objectStore("scans").index("by_customer").getAll(id);
    await Promise.all([
      ...scans.map((s) => tx.objectStore("scans").put({ ...s, customerId: null })),
      tx.objectStore("customers").delete(id),
    ]);
    await tx.done;
  }
}
