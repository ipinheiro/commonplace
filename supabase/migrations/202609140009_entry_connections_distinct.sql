-- An entry linked both by ID and by title used to appear twice in entry_connections.links,
-- once per link row. Each resolved target is now listed once, at its first position.
begin;

create or replace function api.entry_connections(p_entry_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    v_entry app.entries;
    v_space text;
    v_links jsonb;
    v_backlinks jsonb;
    v_ghosts jsonb;
begin
    select * into v_entry from app.entries
        where id = p_entry_id and owner_id = auth.uid() and deleted_at is null;
    if not found then
        raise exception 'Entry not found' using errcode = 'PT404';
    end if;
    v_space := coalesce(v_entry.metadata->>'space', 'personal');

    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'kind', r.kind)
        order by r.position), '[]')
    into v_links
    from (
        select distinct on (t.id) l.position, t.id, t.title, t.kind
        from app.entry_links l
        join lateral (
            select t.id, t.title, t.kind from app.entries t
            where t.owner_id = l.owner_id and t.deleted_at is null
                and coalesce(t.metadata->>'space', 'personal') = v_space
                and (t.id = l.target_id
                    or (l.ghost_title is not null
                        and lower(btrim(t.title)) = lower(btrim(l.ghost_title))))
            order by t.created_at, t.id
            limit 1
        ) t on true
        where l.owner_id = v_entry.owner_id and l.source_id = v_entry.id
        order by t.id, l.position
    ) r;

    select coalesce(jsonb_agg(l.ghost_title order by l.position), '[]')
    into v_ghosts
    from app.entry_links l
    where l.owner_id = v_entry.owner_id and l.source_id = v_entry.id
        and l.ghost_title is not null
        and not exists (
            select 1 from app.entries t
            where t.owner_id = l.owner_id and t.deleted_at is null
                and coalesce(t.metadata->>'space', 'personal') = v_space
                and lower(btrim(t.title)) = lower(btrim(l.ghost_title)));

    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'kind', s.kind,
        'entry_date', app.entry_date(s)) order by s.created_at desc, s.id desc), '[]')
    into v_backlinks
    from app.entries s
    where s.owner_id = v_entry.owner_id and s.deleted_at is null and s.id <> v_entry.id
        and coalesce(s.metadata->>'space', 'personal') = v_space
        and exists (
            select 1 from app.entry_links l
            where l.owner_id = s.owner_id and l.source_id = s.id
                and (l.target_id = v_entry.id
                    or lower(btrim(l.ghost_title)) = lower(btrim(v_entry.title))));

    return jsonb_build_object('links', v_links, 'backlinks', v_backlinks, 'ghosts', v_ghosts);
end;
$$;

notify pgrst, 'reload schema';
commit;
