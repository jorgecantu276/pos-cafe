insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-photos', 'catalog-photos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']);

create policy "Catalog administrators can upload photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'catalog-photos' and (select cafe_private.is_admin()));
