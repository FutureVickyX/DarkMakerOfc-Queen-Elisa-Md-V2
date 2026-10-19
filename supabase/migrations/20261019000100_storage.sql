-- Private bucket for capture photos. Objects are stored as <owner_id>/<scan_id>/<capture_id>.<ext>.
-- Uploading is opt-in in the app; when declined only measurements are stored.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-images', 'scan-images', false, 26214400, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

create policy scan_images_select_own on storage.objects for select to authenticated
  using (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy scan_images_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy scan_images_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);
