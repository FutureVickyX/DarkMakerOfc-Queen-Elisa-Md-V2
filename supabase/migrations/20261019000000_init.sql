-- NailMeasure initial schema.
-- Security model:
--   * Every user-owned row carries owner_id and is protected by Row Level Security.
--   * Authenticated users may READ and DELETE their own scans/measurements directly,
--     and fully manage their own customers.
--   * Scans, captures, measurements and revisions are WRITTEN only by the server API
--     (service role) after it re-derives calibration and measurements from raw inputs,
--     so client-submitted calibration statuses or dimensions are never trusted.
--   * Photos live in a private storage bucket under <owner_id>/<scan_id>/...

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers (optional; store a reference, not unnecessary personal data)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_reference text not null check (char_length(customer_reference) between 1 and 120),
  created_at timestamptz not null default now()
);
create index customers_owner_idx on public.customers (owner_id);

-- ---------------------------------------------------------------------------
-- Calibration devices (reference data)
-- ---------------------------------------------------------------------------
create table public.calibration_devices (
  id uuid primary key default gen_random_uuid(),
  marker_layout text not null unique,
  known_dimensions_mm jsonb not null,
  version integer not null check (version > 0),
  created_at timestamptz not null default now()
);

insert into public.calibration_devices (marker_layout, known_dimensions_mm, version) values (
  'NM-CARD-1',
  '{"dictionary":"DICT_4X4_50","card_width_mm":85.6,"card_height_mm":54,"marker_size_mm":15,
    "markers":[{"id":0,"origin_mm":[4,4]},{"id":1,"origin_mm":[66.6,4]},{"id":2,"origin_mm":[66.6,35]},{"id":3,"origin_mm":[4,35]}],
    "verification_bar_mm":50}'::jsonb,
  1
);

-- ---------------------------------------------------------------------------
-- Scans
-- ---------------------------------------------------------------------------
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  capture_method text check (capture_method in ('camera', 'upload', 'mixed')),
  device_info jsonb,
  calibration_status text not null default 'not_calibrated'
    check (calibration_status in ('valid', 'manual', 'rejected', 'not_calibrated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scans_owner_created_idx on public.scans (owner_id, created_at desc);
create index scans_customer_idx on public.scans (customer_id);

-- A scan may only reference a customer owned by the same user.
create function public.enforce_scan_customer_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c where c.id = new.customer_id and c.owner_id = new.owner_id
  ) then
    raise exception 'customer does not belong to scan owner';
  end if;
  return new;
end;
$$;
create trigger scans_customer_owner before insert or update of customer_id, owner_id on public.scans
  for each row execute function public.enforce_scan_customer_owner();

-- ---------------------------------------------------------------------------
-- Captures (one photo + its calibration)
-- ---------------------------------------------------------------------------
create table public.scan_captures (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  capture_method text not null check (capture_method in ('camera', 'upload')),
  device_info jsonb,
  width integer not null check (width > 0 and width <= 20000),
  height integer not null check (height > 0 and height <= 20000),
  hand_hint text check (hand_hint in ('left', 'right', 'both')),
  calibration_device_id uuid references public.calibration_devices (id),
  calibration_method text check (calibration_method in ('card', 'manual')),
  calibration_status text not null default 'not_calibrated'
    check (calibration_status in ('valid', 'manual', 'rejected', 'not_calibrated')),
  -- Server-recomputed calibration record (homography, residuals, issues).
  calibration jsonb,
  -- Raw inputs used to recompute calibration server-side.
  detected_markers jsonb,
  manual_reference jsonb,
  quality jsonb,
  image_storage_path text check (image_storage_path is null or char_length(image_storage_path) <= 300),
  created_at timestamptz not null default now()
);
create index scan_captures_scan_idx on public.scan_captures (scan_id);
create index scan_captures_owner_idx on public.scan_captures (owner_id);

-- ---------------------------------------------------------------------------
-- Nail measurements
-- ---------------------------------------------------------------------------
create table public.nail_measurements (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  capture_id uuid not null references public.scan_captures (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  hand text check (hand in ('left', 'right')),
  finger text check (finger in ('thumb', 'index', 'middle', 'ring', 'little')),
  width_mm double precision check (width_mm is null or width_mm > 0),
  length_mm double precision check (length_mm is null or length_mm > 0),
  area_mm2 double precision check (area_mm2 is null or area_mm2 > 0),
  axial_extent_mm double precision,
  perimeter_mm double precision,
  -- Only trained models report confidence; heuristic/manual contours store null.
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status text not null default 'pending' check (review_status in ('pending', 'confirmed', 'rejected')),
  validity text check (validity in ('ok', 'warning', 'invalid')),
  calibration_status text not null check (calibration_status in ('valid', 'manual', 'rejected', 'not_calibrated')),
  contour jsonb not null,
  contour_source text not null check (contour_source in ('model', 'heuristic', 'manual')),
  manually_edited boolean not null default false,
  axis jsonb not null,
  detection jsonb,
  issues jsonb not null default '[]'::jsonb,
  calibration_uncertainty_mm double precision,
  engine_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((hand is null) = (finger is null))
);
create index nail_measurements_scan_idx on public.nail_measurements (scan_id);
create index nail_measurements_capture_idx on public.nail_measurements (capture_id);
create index nail_measurements_owner_idx on public.nail_measurements (owner_id);

-- ---------------------------------------------------------------------------
-- Measurement revisions (audit trail; written by the server)
-- ---------------------------------------------------------------------------
create table public.measurement_revisions (
  id uuid primary key default gen_random_uuid(),
  measurement_id uuid not null references public.nail_measurements (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  previous_values jsonb,
  updated_values jsonb not null,
  reason text not null check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index measurement_revisions_measurement_idx on public.measurement_revisions (measurement_id);

-- ---------------------------------------------------------------------------
-- Scan assets (private storage objects)
-- ---------------------------------------------------------------------------
create table public.scan_assets (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  asset_type text not null check (asset_type in ('capture_image', 'report_pdf')),
  created_at timestamptz not null default now()
);
create index scan_assets_scan_idx on public.scan_assets (scan_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.calibration_devices enable row level security;
alter table public.scans enable row level security;
alter table public.scan_captures enable row level security;
alter table public.nail_measurements enable row level security;
alter table public.measurement_revisions enable row level security;
alter table public.scan_assets enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy customers_select_own on public.customers for select to authenticated using (owner_id = auth.uid());
create policy customers_insert_own on public.customers for insert to authenticated with check (owner_id = auth.uid());
create policy customers_update_own on public.customers for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy customers_delete_own on public.customers for delete to authenticated using (owner_id = auth.uid());

create policy calibration_devices_read on public.calibration_devices for select to authenticated using (true);

-- Measurement data: read + delete own rows only. Writes go through the server API.
create policy scans_select_own on public.scans for select to authenticated using (owner_id = auth.uid());
create policy scans_delete_own on public.scans for delete to authenticated using (owner_id = auth.uid());
create policy scan_captures_select_own on public.scan_captures for select to authenticated using (owner_id = auth.uid());
create policy scan_captures_delete_own on public.scan_captures for delete to authenticated using (owner_id = auth.uid());
create policy nail_measurements_select_own on public.nail_measurements for select to authenticated using (owner_id = auth.uid());
create policy nail_measurements_delete_own on public.nail_measurements for delete to authenticated using (owner_id = auth.uid());
create policy measurement_revisions_select_own on public.measurement_revisions for select to authenticated using (owner_id = auth.uid());
create policy scan_assets_select_own on public.scan_assets for select to authenticated using (owner_id = auth.uid());
create policy scan_assets_delete_own on public.scan_assets for delete to authenticated using (owner_id = auth.uid());

-- Create a profile row when a user signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
