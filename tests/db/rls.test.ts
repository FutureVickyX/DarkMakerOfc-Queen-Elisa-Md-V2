/**
 * Applies the Supabase migrations to an embedded Postgres (PGlite) with minimal
 * stand-ins for Supabase's auth/storage schemas, then checks Row Level Security
 * from the `authenticated` role's point of view.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to authenticated, anon, service_role;
grant execute on all functions in schema auth to authenticated, anon;
`;

const GRANTS = `
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
`;

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let db: PGlite;

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);` : `reset role;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`);
  // Seed as the server (service role bypasses RLS).
  await db.exec(`
    insert into public.customers (id, owner_id, customer_reference) values ('c0000000-0000-4000-8000-00000000000a', '${A}', 'A-1');
    insert into public.scans (id, owner_id, customer_id, name) values ('50000000-0000-4000-8000-00000000000a', '${A}', 'c0000000-0000-4000-8000-00000000000a', 'A scan');
    insert into public.scans (id, owner_id, name) values ('50000000-0000-4000-8000-00000000000b', '${B}', 'B scan');
    insert into public.scan_captures (id, scan_id, owner_id, capture_method, width, height) values
      ('ca000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-00000000000a', '${A}', 'upload', 100, 100);
    insert into public.nail_measurements (id, scan_id, capture_id, owner_id, hand, finger, width_mm, length_mm, calibration_status, contour, contour_source, axis, engine_version)
      values ('aa000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-00000000000a', '${A}', 'left', 'index', 14, 12, 'valid', '[]', 'manual', '{}', '1.0.0');
  `);
}, 60_000);

describe("database schema and RLS", () => {
  it("creates profiles for new users", async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.profiles`);
    expect(r.rows[0]!.n).toBe(2);
  });

  it("seeds the NM-CARD-1 calibration device", async () => {
    const r = await as(A, () => db.query<{ marker_layout: string }>(`select marker_layout from public.calibration_devices`));
    expect(r.rows.map((x) => x.marker_layout)).toEqual(["NM-CARD-1"]);
  });

  it("only shows a user their own scans and measurements", async () => {
    const a = await as(A, () => db.query<{ name: string }>(`select name from public.scans`));
    expect(a.rows.map((r) => r.name)).toEqual(["A scan"]);
    const b = await as(B, () => db.query(`select * from public.nail_measurements`));
    expect(b.rows).toHaveLength(0);
    const anon = await as(B, () => db.query(`select * from public.customers`));
    expect(anon.rows).toHaveLength(0);
  });

  it("prevents users from writing measurements directly (server-only writes)", async () => {
    await expect(
      as(A, () =>
        db.exec(`insert into public.scans (owner_id, name) values ('${A}', 'forged')`),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await as(A, () => db.query(`update public.nail_measurements set width_mm = 99 returning id`));
    expect(upd.rows).toHaveLength(0);
  });

  it("lets users delete their own scans with cascading measurements, but not others'", async () => {
    const del = await as(B, () => db.query(`delete from public.scans where id = '50000000-0000-4000-8000-00000000000a' returning id`));
    expect(del.rows).toHaveLength(0);
    await as(A, () => db.query(`delete from public.scans where id = '50000000-0000-4000-8000-00000000000a'`));
    const left = await db.query(`select * from public.nail_measurements`);
    expect(left.rows).toHaveLength(0);
  });

  it("lets users manage their own customers only", async () => {
    await as(B, () => db.exec(`insert into public.customers (owner_id, customer_reference) values ('${B}', 'B-1')`));
    await expect(as(B, () => db.exec(`insert into public.customers (owner_id, customer_reference) values ('${A}', 'sneaky')`))).rejects.toThrow(/row-level security/);
  });

  it("rejects a scan linked to another user's customer", async () => {
    await expect(
      db.exec(`insert into public.scans (owner_id, customer_id, name) values ('${B}', 'c0000000-0000-4000-8000-00000000000a', 'cross')`),
    ).rejects.toThrow(/customer does not belong/);
  });

  it("enforces measurement value constraints", async () => {
    await expect(
      db.exec(`insert into public.scans (id, owner_id, name) values ('50000000-0000-4000-8000-0000000000cc', '${A}', 'x');
        insert into public.scan_captures (id, scan_id, owner_id, capture_method, width, height) values ('ca000000-0000-4000-8000-0000000000cc', '50000000-0000-4000-8000-0000000000cc', '${A}', 'upload', 10, 10);
        insert into public.nail_measurements (scan_id, capture_id, owner_id, width_mm, calibration_status, contour, contour_source, axis, engine_version, confidence)
        values ('50000000-0000-4000-8000-0000000000cc', 'ca000000-0000-4000-8000-0000000000cc', '${A}', -1, 'valid', '[]', 'manual', '{}', '1', 2)`),
    ).rejects.toThrow(/check constraint/);
  });

  it("restricts storage objects to the owner's folder", async () => {
    await as(A, () => db.exec(`insert into storage.objects (bucket_id, name) values ('scan-images', '${A}/s/c.jpg')`));
    await expect(as(A, () => db.exec(`insert into storage.objects (bucket_id, name) values ('scan-images', '${B}/s/c.jpg')`))).rejects.toThrow(/row-level security/);
    const seen = await as(B, () => db.query(`select * from storage.objects`));
    expect(seen.rows).toHaveLength(0);
    const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'scan-images'`);
    expect(bucket.rows[0]!.public).toBe(false);
  });
});
