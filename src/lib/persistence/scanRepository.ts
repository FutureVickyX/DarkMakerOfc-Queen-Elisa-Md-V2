import type { Customer, Scan, ScanSummary } from "@/lib/scan/model";

export type StorageMode = "local" | "supabase";

/**
 * Persistence boundary for scans, captures, nail records, customers and images.
 * Implementations: LocalScanRepository (IndexedDB, this device only) and
 * SupabaseScanRepository (authenticated cloud persistence with RLS).
 */
export interface ScanRepository {
  readonly mode: StorageMode;
  /** Whether captured photos are uploaded (cloud mode requires explicit consent). */
  readonly storesImages: boolean;

  listScans(): Promise<ScanSummary[]>;
  getScan(id: string): Promise<Scan | null>;
  saveScan(scan: Scan): Promise<Scan>;
  /** Deletes the scan, its measurements and all associated images. */
  deleteScan(id: string): Promise<void>;

  putImage(scanId: string, captureId: string, blob: Blob): Promise<string | null>;
  getImage(assetId: string): Promise<Blob | null>;
  deleteImage(assetId: string): Promise<void>;

  listCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
  saveCustomer(customer: Customer): Promise<Customer>;
  /** Deletes the customer; their scans are kept but unlinked. */
  deleteCustomer(id: string): Promise<void>;
}
