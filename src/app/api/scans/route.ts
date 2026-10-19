import { NextResponse, type NextRequest } from "next/server";
import { rowsToScan, scanToRows, type CaptureRow, type NailRow, type RevisionRow, type ScanRow } from "@/lib/persistence/supabaseRows";
import { recomputeScan } from "@/lib/server/recomputeScan";
import { scanPayloadSchema } from "@/lib/server/scanPayload";
import { getAdminSupabase } from "@/lib/supabase/adminClient";
import { IMAGE_BUCKET } from "@/lib/supabase/config";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_000_000;

/**
 * Saves a scan for the authenticated user. Calibration and measurements are
 * recomputed here from raw inputs (marker corners, contours) so that
 * client-submitted statuses, dimensions and confidence values are not trusted.
 */
export async function POST(req: NextRequest) {
  const admin = getAdminSupabase();
  if (!admin) return NextResponse.json({ error: "Cloud persistence is not configured on this server." }, { status: 503 });

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: userData, error: authError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (authError || !user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = scanPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scan", issues: parsed.error.issues.slice(0, 20) }, { status: 400 });
  }
  const payload = parsed.data;

  // Ownership: an existing scan id must belong to the caller.
  const { data: existing, error: existingError } = await admin.from("scans").select("*").eq("id", payload.id).maybeSingle<ScanRow>();
  if (existingError) return NextResponse.json({ error: "Database error" }, { status: 500 });
  if (existing && existing.owner_id !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (payload.customerId) {
    const { data: customer } = await admin.from("customers").select("id").eq("id", payload.customerId).eq("owner_id", user.id).maybeSingle();
    if (!customer) return NextResponse.json({ error: "Unknown customer" }, { status: 400 });
  }

  const prefix = `${user.id}/${payload.id}/`;
  for (const c of payload.captures) {
    if (c.imageAssetId && (!c.imageAssetId.startsWith(prefix) || c.imageAssetId.includes(".."))) {
      return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
    }
  }

  let previous = null;
  if (existing) {
    const [captures, nails] = await Promise.all([
      admin.from("scan_captures").select("*").eq("scan_id", payload.id),
      admin.from("nail_measurements").select("*").eq("scan_id", payload.id),
    ]);
    const nailIds = (nails.data ?? []).map((n: NailRow) => n.id);
    const revisions = nailIds.length > 0 ? await admin.from("measurement_revisions").select("*").in("measurement_id", nailIds) : { data: [] };
    previous = rowsToScan(existing, (captures.data ?? []) as CaptureRow[], (nails.data ?? []) as NailRow[], (revisions.data ?? []) as RevisionRow[]);
  }

  const scan = recomputeScan(payload, previous);
  const rows = scanToRows(scan, user.id);

  const fail = (what: string, e: { message?: string } | null) => {
    console.error(`[api/scans] ${what}`, e?.message);
    return NextResponse.json({ error: `Could not save ${what}` }, { status: 500 });
  };

  const s1 = await admin.from("scans").upsert(rows.scanRow);
  if (s1.error) return fail("scan", s1.error);

  const keepCaptures = rows.captureRows.map((c) => c.id);
  const removedCaptures = (previous?.captures ?? []).filter((c) => !keepCaptures.includes(c.id));
  if (removedCaptures.length > 0) {
    const paths = removedCaptures.map((c) => c.imageAssetId).filter((p): p is string => !!p);
    if (paths.length > 0) {
      await admin.storage.from(IMAGE_BUCKET).remove(paths);
      await admin.from("scan_assets").delete().in("storage_path", paths).eq("owner_id", user.id);
    }
    const del = await admin.from("scan_captures").delete().in("id", removedCaptures.map((c) => c.id)).eq("owner_id", user.id);
    if (del.error) return fail("captures", del.error);
  }
  if (rows.captureRows.length > 0) {
    const s2 = await admin.from("scan_captures").upsert(rows.captureRows);
    if (s2.error) return fail("captures", s2.error);
  }

  const keepNails = new Set(rows.nailRows.map((n) => n.id));
  const removedNails = (previous?.nails ?? []).filter((n) => !keepNails.has(n.id)).map((n) => n.id);
  if (removedNails.length > 0) {
    const del = await admin.from("nail_measurements").delete().in("id", removedNails).eq("owner_id", user.id);
    if (del.error) return fail("measurements", del.error);
  }
  if (rows.nailRows.length > 0) {
    const s3 = await admin.from("nail_measurements").upsert(rows.nailRows);
    if (s3.error) return fail("measurements", s3.error);
  }
  if (rows.revisionRows.length > 0) {
    const s4 = await admin.from("measurement_revisions").upsert(rows.revisionRows, { onConflict: "id", ignoreDuplicates: true });
    if (s4.error) return fail("revisions", s4.error);
  }
  const assetRows = scan.captures
    .filter((c) => c.imageAssetId)
    .map((c) => ({ scan_id: scan.id, owner_id: user.id, storage_path: c.imageAssetId!, asset_type: "capture_image" }));
  if (assetRows.length > 0) {
    const s5 = await admin.from("scan_assets").upsert(assetRows, { onConflict: "storage_path", ignoreDuplicates: true });
    if (s5.error) return fail("assets", s5.error);
  }

  return NextResponse.json({ scan });
}
