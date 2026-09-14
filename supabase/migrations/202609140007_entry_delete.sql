-- Deleting tombstones the row. Every reader already filters on deleted_at, so
-- the entry leaves lists, search and edits at once while staying restorable.
begin;

create function api.delete_entry(p_entry_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
    update app.entries set deleted_at = clock_timestamp()
        where id = p_entry_id and owner_id = auth.uid() and deleted_at is null;
    if not found then
        raise exception 'Entry not found' using errcode = 'PT404';
    end if;
end;
$$;
revoke all on function api.delete_entry(uuid) from public, anon;
grant execute on function api.delete_entry(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
