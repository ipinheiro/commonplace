-- Private image objects are stored beneath the authenticated owner's ID.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-images', 'entry-images', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

create policy entry_images_read on storage.objects for select to authenticated
using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy entry_images_insert on storage.objects for insert to authenticated
with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- An upload retry writes the same bytes to its preassigned path.
create policy entry_images_update on storage.objects for update to authenticated
using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
