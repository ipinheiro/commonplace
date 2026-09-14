-- Links are edges between entries, rewritten from the body on every save by a
-- trigger, so rows can never disagree with the text. A title link with no
-- matching entry is a ghost and resolves at read time.
begin;

create table app.entry_links (
    owner_id uuid not null references auth.users(id),
    source_id uuid not null,
    target_id uuid,
    ghost_title text,
    position integer not null,
    foreign key (owner_id, source_id) references app.entries(owner_id, id),
    foreign key (owner_id, target_id) references app.entries(owner_id, id),
    check ((target_id is null) <> (ghost_title is null)),
    check (ghost_title is null or length(btrim(ghost_title)) between 1 and 300)
);
create unique index entry_links_target on app.entry_links (owner_id, source_id, target_id)
    where target_id is not null;
create unique index entry_links_ghost on app.entry_links (owner_id, source_id, lower(btrim(ghost_title)))
    where ghost_title is not null;
create index entry_links_backlinks on app.entry_links (owner_id, target_id);
create index entry_links_ghost_titles on app.entry_links (owner_id, lower(btrim(ghost_title)));

alter table app.entry_links enable row level security;
create policy entry_links_owner on app.entry_links to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
grant select, insert, delete on app.entry_links to authenticated;
revoke all on app.entry_links from anon;

-- Fenced and inline code are blanked before matching. A fence that itself
-- contains a backtick splits into pieces but still hides its links. Tilde
-- fences are not recognised.
create function app.entry_links_in(p_body text)
returns table(link_position integer, target_id uuid, label text, ghost_title text)
language plpgsql immutable set search_path = '' as $$
declare
    v_match text[];
    v_inner text;
    v_id text;
    v_position integer := 0;
begin
    for v_match in
        select m from regexp_matches(
            regexp_replace(coalesce(p_body, ''), '```[^`]*```|`[^`]*`', ' ', 'g'),
            '\[\[([^\]\n]+)\]\]', 'g') as m
    loop
        v_inner := v_match[1];
        v_id := substring(v_inner from
            '^\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*(?:\|.*)?$');
        if v_id is not null then
            v_position := v_position + 1;
            link_position := v_position;
            target_id := v_id::uuid;
            label := nullif(btrim(substring(v_inner from '\|(.*)$')), '');
            ghost_title := null;
            return next;
        elsif length(btrim(v_inner)) between 1 and 300 then
            v_position := v_position + 1;
            link_position := v_position;
            target_id := null;
            label := null;
            ghost_title := btrim(v_inner);
            return next;
        end if;
    end loop;
end;
$$;
grant execute on function app.entry_links_in(text) to authenticated;

create function app.sync_entry_links() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    delete from app.entry_links where owner_id = new.owner_id and source_id = new.id;
    insert into app.entry_links (owner_id, source_id, target_id, ghost_title, position)
    select distinct on (coalesce(t.id::text, lower(btrim(coalesce(c.ghost_title, c.label, c.target_id::text)))))
        new.owner_id,
        new.id,
        t.id,
        case when t.id is null then coalesce(c.ghost_title, c.label, c.target_id::text) end,
        c.link_position
    from app.entry_links_in(new.body_markdown) c
    left join app.entries t on t.owner_id = new.owner_id and t.id = c.target_id
    where (t.id is null or t.id <> new.id)
        and lower(btrim(coalesce(c.ghost_title, ''))) <> lower(btrim(new.title))
    order by coalesce(t.id::text, lower(btrim(coalesce(c.ghost_title, c.label, c.target_id::text)))), c.link_position
    on conflict do nothing;
    return new;
end;
$$;
create trigger sync_entry_links after insert or update of body_markdown, title on app.entries
for each row execute function app.sync_entry_links();

create function api.entry_connections(p_entry_id uuid) returns jsonb
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
        select l.position, t.id, t.title, t.kind
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

create function api.search_titles(
    p_query text,
    p_space text default 'personal',
    p_limit integer default 8
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    v_pattern text;
    v_items jsonb;
begin
    if p_query is null or length(p_query) > 300
        or p_space is null or p_space not in ('personal', 'work')
        or p_limit is null or p_limit not between 1 and 20 then
        raise exception 'Invalid title search' using errcode = '22023';
    end if;
    v_pattern := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind)
        order by e.updated_at desc, e.id desc), '[]')
    into v_items
    from (
        select e.id, e.title, e.kind, e.updated_at from app.entries e
        where e.owner_id = auth.uid() and e.deleted_at is null
            and coalesce(e.metadata->>'space', 'personal') = p_space
            and e.title ilike v_pattern escape '\'
        order by e.updated_at desc, e.id desc
        limit p_limit
    ) e;
    return v_items;
end;
$$;

revoke all on function api.entry_connections(uuid), api.search_titles(text, text, integer) from public, anon;
grant execute on function api.entry_connections(uuid), api.search_titles(text, text, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
