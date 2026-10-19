"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer, Scan, ScanSummary } from "@/lib/scan/model";
import { summarize } from "@/lib/scan/scanService";
import { IMAGE_BUCKET } from "@/lib/supabase/config";
import type { ScanRepository } from "./scanRepository";
import { rowsToScan, type CaptureRow, type NailRow, type RevisionRow, type ScanRow } from "./supabaseRows";

/**
 * Cloud persistence. Reads use the signed-in user's session (RLS restricts rows
 * to the owner). Scan writes go through POST /api/scans, which recomputes
 * calibration and measurements server-side. Photos are uploaded to a private
 * bucket only when the user has opted in.
 */
export class SupabaseScanRepository implements ScanRepository {
  readonly mode = "supabase" as const;

  constructor(
    private readonly client: SupabaseClient,
    readonly storesImages: boolean,
  ) {}

  private async userId(): Promise<string> {
    const { data } = await this.client.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error("Not signed in");
    return id;
  }

  async listScans(): Promise<ScanSummary[]> {
    const { data: scans, error } = await this.client.from("scans").select("*").order("updated_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    if (!scans || scans.length === 0) return [];
    const ids = scans.map((s: ScanRow) => s.id);
    const [captures, nails] = await Promise.all([
      this.client.from("scan_captures").select("*").in("scan_id", ids),
      this.client.from("nail_measurements").select("*").in("scan_id", ids),
    ]);
    if (captures.error) throw new Error(captures.error.message);
    if (nails.error) throw new Error(nails.error.message);
    return (scans as ScanRow[]).map((s) =>
      summarize(
        rowsToScan(
          s,
          (captures.data as CaptureRow[]).filter((c) => c.scan_id === s.id),
          (nails.data as NailRow[]).filter((n) => n.scan_id === s.id),
          [],
        ),
      ),
    );
  }

  async getScan(id: string): Promise<Scan | null> {
    const { data: scan, error } = await this.client.from("scans").select("*").eq("id", id).maybeSingle<ScanRow>();
    if (error) throw new Error(error.message);
    if (!scan) return null;
    const [captures, nails] = await Promise.all([
      this.client.from("scan_captures").select("*").eq("scan_id", id),
      this.client.from("nail_measurements").select("*").eq("scan_id", id),
    ]);
    if (captures.error) throw new Error(captures.error.message);
    if (nails.error) throw new Error(nails.error.message);
    const nailIds = (nails.data as NailRow[]).map((n) => n.id);
    const revisions = nailIds.length > 0 ? await this.client.from("measurement_revisions").select("*").in("measurement_id", nailIds) : { data: [], error: null };
    if (revisions.error) throw new Error(revisions.error.message);
    return rowsToScan(scan, captures.data as CaptureRow[], nails.data as NailRow[], (revisions.data ?? []) as RevisionRow[]);
  }

  async saveScan(scan: Scan): Promise<Scan> {
    const { data } = await this.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Not signed in");
    const res = await fetch("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(scan),
    });
    const body = (await res.json().catch(() => ({}))) as { scan?: Scan; error?: string };
    if (!res.ok || !body.scan) throw new Error(body.error ?? `Save failed (${res.status})`);
    return body.scan;
  }

  async deleteScan(id: string): Promise<void> {
    const uid = await this.userId();
    const folder = `${uid}/${id}`;
    const { data: objects } = await this.client.storage.from(IMAGE_BUCKET).list(folder, { limit: 1000 });
    if (objects && objects.length > 0) {
      const { error } = await this.client.storage.from(IMAGE_BUCKET).remove(objects.map((o) => `${folder}/${o.name}`));
      if (error) throw new Error(`Could not delete images: ${error.message}`);
    }
    const { error } = await this.client.from("scans").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async putImage(scanId: string, captureId: string, blob: Blob): Promise<string | null> {
    if (!this.storesImages) return null;
    const uid = await this.userId();
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${uid}/${scanId}/${captureId}.${ext}`;
    const { error } = await this.client.storage.from(IMAGE_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
    if (error) throw new Error(`Image upload failed: ${error.message}`);
    return path;
  }

  async getImage(assetId: string): Promise<Blob | null> {
    const { data, error } = await this.client.storage.from(IMAGE_BUCKET).download(assetId);
    if (error) return null;
    return data;
  }

  async deleteImage(assetId: string): Promise<void> {
    await this.client.storage.from(IMAGE_BUCKET).remove([assetId]);
  }

  async listCustomers(): Promise<Customer[]> {
    const { data, error } = await this.client.from("customers").select("*").order("customer_reference");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { id: string; customer_reference: string; created_at: string }) => ({
      id: r.id,
      customerReference: r.customer_reference,
      createdAt: r.created_at,
    }));
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const { data, error } = await this.client.from("customers").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, customerReference: data.customer_reference, createdAt: data.created_at } : null;
  }

  async saveCustomer(customer: Customer): Promise<Customer> {
    const uid = await this.userId();
    const { error } = await this.client
      .from("customers")
      .upsert({ id: customer.id, owner_id: uid, customer_reference: customer.customerReference, created_at: customer.createdAt });
    if (error) throw new Error(error.message);
    return customer;
  }

  async deleteCustomer(id: string): Promise<void> {
    const { error } = await this.client.from("customers").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
}
