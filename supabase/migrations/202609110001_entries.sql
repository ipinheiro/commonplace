-- Run as the database migration owner. Only `api` is exposed through PostgREST.
begin;

create schema app;
create schema api;
revoke all on schema app from public, anon;
revoke all on schema api from public;
grant usage on schema app, api to authenticated;
grant usage on schema api to anon;
alter default privileges in schema api revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from public;

create table app.entries (
    id uuid primary key,
    owner_id uuid not null references auth.users(id),
    title text not null check (length(btrim(title)) between 1 and 300),
    body_markdown text not null default '' check (length(body_markdown) <= 1000000),
    kind text not null default 'note' check (length(btrim(kind)) between 1 and 64),
    metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    version bigint not null default 1 check (version > 0),
    deleted_at timestamptz,
    search_document tsvector generated always as (
        setweight(to_tsvector('simple', title), 'A') ||
        setweight(to_tsvector('simple', body_markdown), 'B')
    ) stored,
    unique (owner_id, id)
);

create index entries_recent on app.entries (owner_id, created_at desc, id desc)
    where deleted_at is null;
create index entries_search on app.entries using gin(search_document)
    where deleted_at is null;

-- A receipt makes an uncertain save retry return its original result. It is not
-- an offline queue. Payload and receipt are committed with the entry mutation.
create table app.mutations (
    owner_id uuid not null references auth.users(id),
    request_id uuid not null,
    payload jsonb not null,
    result jsonb,
    created_at timestamptz not null default clock_timestamp(),
    primary key (owner_id, request_id)
);

alter table app.entries enable row level security;
alter table app.mutations enable row level security;
create policy entries_owner on app.entries to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy mutations_owner on app.mutations to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
grant select, insert, update on app.entries, app.mutations to authenticated;
revoke all on app.entries, app.mutations from anon;

create function app.stamp_entry() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        new.owner_id := auth.uid();
        new.version := 1;
        new.created_at := clock_timestamp();
    else
        if new.id <> old.id or new.owner_id <> old.owner_id then
            raise exception 'Immutable entry identity' using errcode = '22023';
        end if;
        new.created_at := old.created_at;
        new.version := old.version + 1;
    end if;
    new.updated_at := clock_timestamp();
    return new;
end;
$$;
create trigger stamp_entry before insert or update on app.entries
for each row execute function app.stamp_entry();

create function app.entry_json(p_entry app.entries) returns jsonb
language sql stable security invoker set search_path = '' as $$
    select to_jsonb(p_entry) - 'owner_id' - 'search_document';
$$;
grant execute on function app.entry_json(app.entries) to authenticated;

create function api.save_entry(
    p_request_id uuid,
    p_entry_id uuid,
    p_expected_version bigint,
    p_title text,
    p_body_markdown text,
    p_kind text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_owner uuid := auth.uid();
    v_payload jsonb;
    v_receipt app.mutations;
    v_entry app.entries;
    v_result jsonb;
begin
    if v_owner is null then
        raise exception 'Sign in to save entries' using errcode = '42501';
    end if;
    if p_request_id is null or p_entry_id is null or p_title is null
        or p_body_markdown is null or p_kind is null
        or length(btrim(p_title)) not between 1 and 300
        or length(p_body_markdown) > 1000000
        or length(btrim(p_kind)) not between 1 and 64
        or (p_expected_version is not null and p_expected_version < 1) then
        raise exception 'Invalid entry input' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object(
        'entry_id', p_entry_id, 'expected_version', p_expected_version,
        'title', p_title, 'body', p_body_markdown, 'kind', p_kind
    );
    -- A unique insert waits for any concurrent request with the same key.
    insert into app.mutations(owner_id, request_id, payload)
        values (v_owner, p_request_id, v_payload)
        on conflict (owner_id, request_id) do nothing;
    select * into strict v_receipt from app.mutations
        where owner_id = v_owner and request_id = p_request_id for update;
    if v_receipt.payload <> v_payload then
        raise exception 'Request identity reused with different content'
            using errcode = 'PT409';
    end if;
    if v_receipt.result is not null then
        return v_receipt.result;
    end if;

    if p_expected_version is null then
        begin
            insert into app.entries(id, owner_id, title, body_markdown, kind)
                values (p_entry_id, v_owner, btrim(p_title), p_body_markdown, btrim(p_kind))
                returning * into v_entry;
        exception when unique_violation then
            raise exception 'Entry identity is unavailable' using errcode = 'PT409';
        end;
    else
        update app.entries set title = btrim(p_title),
            body_markdown = p_body_markdown, kind = btrim(p_kind)
            where id = p_entry_id and owner_id = v_owner
                and deleted_at is null and version = p_expected_version
            returning * into v_entry;
        if not found then
            if exists (select 1 from app.entries where id = p_entry_id
                and owner_id = v_owner and deleted_at is null) then
                raise exception 'Entry changed on another device' using errcode = 'PT409';
            end if;
            raise exception 'Entry not found' using errcode = 'PT404';
        end if;
    end if;
    v_result := app.entry_json(v_entry);
    update app.mutations set result = v_result
        where owner_id = v_owner and request_id = p_request_id;
    return v_result;
end;
$$;

create function api.get_entry(p_entry_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_entry app.entries;
begin
    select * into v_entry from app.entries
        where id = p_entry_id and owner_id = auth.uid() and deleted_at is null;
    if not found then
        raise exception 'Entry not found' using errcode = 'PT404';
    end if;
    return app.entry_json(v_entry);
end;
$$;

create function api.list_entries(
    p_query text default '',
    p_kind text default null,
    p_before_created timestamptz default null,
    p_before_id uuid default null,
    p_limit integer default 30
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_items jsonb; v_cursor jsonb := null;
begin
    if p_limit is null or p_limit not between 1 and 100
        or p_query is null or length(p_query) > 500
        or ((p_before_created is null) <> (p_before_id is null)) then
        raise exception 'Invalid list request' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(app.entry_json(e) order by e.created_at desc, e.id desc), '[]')
        into v_items
        from (
            select * from app.entries
            where owner_id = auth.uid() and deleted_at is null
                and (p_kind is null or kind = p_kind)
                and (btrim(p_query) = '' or search_document @@ websearch_to_tsquery('simple', p_query))
                and (p_before_created is null or (created_at, id) < (p_before_created, p_before_id))
            order by created_at desc, id desc limit p_limit + 1
        ) e;
    if jsonb_array_length(v_items) > p_limit then
        v_items := v_items - p_limit;
        v_cursor := jsonb_build_object('created_at', v_items -> (p_limit - 1) ->> 'created_at',
            'id', v_items -> (p_limit - 1) ->> 'id');
    end if;
    return jsonb_build_object('items', v_items, 'next_cursor', v_cursor);
end;
$$;

revoke all on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated;
commit;
