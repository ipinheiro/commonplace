-- Keep an original entry date without changing creation or update timestamps.
begin;

create or replace function api.save_entry(
    p_request_id uuid,
    p_entry_id uuid,
    p_expected_version bigint,
    p_title text,
    p_body_markdown text,
    p_kind text,
    p_context jsonb default null
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
    if p_context is not null then
        if jsonb_typeof(p_context) <> 'object'
            or not (p_context ?& array['tags', 'url', 'source', 'images'])
            or (p_context - 'tags' - 'url' - 'source' - 'images' - 'date') <> '{}'::jsonb
            or jsonb_typeof(p_context->'tags') <> 'array'
            or jsonb_typeof(p_context->'url') <> 'string'
            or jsonb_typeof(p_context->'source') <> 'string'
            or jsonb_typeof(p_context->'images') <> 'array' then
            raise exception 'Invalid entry context' using errcode = '22023';
        end if;
        if p_context ? 'date' then
            if jsonb_typeof(p_context->'date') <> 'string' then
                raise exception 'Invalid entry date' using errcode = '22023';
            end if;
            if p_context->>'date' <> '' then
                if (p_context->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
                    raise exception 'Invalid entry date' using errcode = '22023';
                end if;
                begin
                    perform (p_context->>'date')::date;
                exception when invalid_datetime_format or datetime_field_overflow then
                    raise exception 'Invalid entry date' using errcode = '22023';
                end;
            end if;
        end if;
        if jsonb_array_length(p_context->'images') > 10
            or exists (select 1 from jsonb_array_elements(p_context->'images') image
                where jsonb_typeof(image) <> 'object'
                    or not (image ?& array['path', 'name'])
                    or jsonb_typeof(image->'path') <> 'string'
                    or jsonb_typeof(image->'name') <> 'string'
                    or length(image->>'name') not between 1 and 255
                    or (image->>'path') !~ ('^' || v_owner::text || '/' || p_entry_id::text || '/[a-f0-9-]{36}$'))
            or jsonb_array_length(p_context->'tags') > 30
            or length(p_context->>'url') > 2048
            or ((p_context->>'url') <> '' and (p_context->>'url') !~ '^https?://[^[:space:]]+')
            or length(p_context->>'source') > 1000
            or exists (select 1 from jsonb_array_elements(p_context->'tags') tag
                where jsonb_typeof(tag) <> 'string' or length(btrim(tag #>> '{}')) not between 1 and 64) then
            raise exception 'Invalid entry context' using errcode = '22023';
        end if;
    end if;
    v_payload := jsonb_build_object(
        'entry_id', p_entry_id, 'expected_version', p_expected_version,
        'title', p_title, 'body', p_body_markdown, 'kind', p_kind
    );
    if p_context is not null then
        v_payload := v_payload || jsonb_build_object('context', p_context);
    end if;
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
            insert into app.entries(id, owner_id, title, body_markdown, kind, metadata)
                values (p_entry_id, v_owner, btrim(p_title), p_body_markdown, btrim(p_kind), coalesce(p_context, '{}'::jsonb))
                returning * into v_entry;
        exception when unique_violation then
            raise exception 'Entry identity is unavailable' using errcode = 'PT409';
        end;
    else
        update app.entries set title = btrim(p_title),
            body_markdown = p_body_markdown, kind = btrim(p_kind),
            metadata = metadata || coalesce(p_context, '{}'::jsonb)
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

revoke all on function api.save_entry(uuid, uuid, bigint, text, text, text, jsonb) from public, anon;
grant execute on function api.save_entry(uuid, uuid, bigint, text, text, text, jsonb) to authenticated;

-- Calendar dates have no time zone. Undated entries use their UTC creation day.
create function app.entry_date(p_entry app.entries) returns date
language plpgsql stable security invoker set search_path = '' as $$
begin
    if jsonb_typeof(p_entry.metadata->'date') = 'string'
        and (p_entry.metadata->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        begin
            return (p_entry.metadata->>'date')::date;
        exception when invalid_datetime_format or datetime_field_overflow then
            null;
        end;
    end if;
    return (p_entry.created_at at time zone 'UTC')::date;
end;
$$;
revoke all on function app.entry_date(app.entries) from public, anon;
grant execute on function app.entry_date(app.entries) to authenticated;

drop function api.list_entries(text, text, timestamptz, uuid, integer);
create function api.list_entries(
    p_query text default '',
    p_kind text default null,
    p_before_created timestamptz default null,
    p_before_id uuid default null,
    p_limit integer default 30,
    p_before_date date default null
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    v_items jsonb;
    v_cursor jsonb := null;
    v_before_date date := p_before_date;
begin
    if p_limit is null or p_limit not between 1 and 100
        or p_query is null or length(p_query) > 500
        or ((p_before_created is null) <> (p_before_id is null))
        or (p_before_date is not null and p_before_created is null) then
        raise exception 'Invalid list request' using errcode = '22023';
    end if;
    -- Older clients send only the timestamp and ID; derive the missing date.
    if p_before_id is not null and v_before_date is null then
        select app.entry_date(e) into v_before_date from app.entries e
            where e.id = p_before_id and e.owner_id = auth.uid();
        v_before_date := coalesce(v_before_date, (p_before_created at time zone 'UTC')::date);
    end if;
    select coalesce(jsonb_agg(app.entry_json(e) || jsonb_build_object('entry_date', app.entry_date(e))
        order by app.entry_date(e) desc, e.created_at desc, e.id desc), '[]')
    into v_items
    from (
        select e.* from app.entries e
        where e.owner_id = auth.uid() and e.deleted_at is null
            and (p_kind is null or e.kind = p_kind)
            and (btrim(p_query) = '' or e.search_document @@ websearch_to_tsquery('simple', p_query))
            and (p_before_created is null or (app.entry_date(e), e.created_at, e.id)
                < (v_before_date, p_before_created, p_before_id))
        order by app.entry_date(e) desc, e.created_at desc, e.id desc
        limit p_limit + 1
    ) e;
    if jsonb_array_length(v_items) > p_limit then
        v_items := v_items - p_limit;
        v_cursor := jsonb_build_object(
            'entry_date', v_items -> (p_limit - 1) ->> 'entry_date',
            'created_at', v_items -> (p_limit - 1) ->> 'created_at',
            'id', v_items -> (p_limit - 1) ->> 'id');
    end if;
    return jsonb_build_object('items', v_items, 'next_cursor', v_cursor);
end;
$$;
revoke all on function api.list_entries(text, text, timestamptz, uuid, integer, date) from public, anon;
grant execute on function api.list_entries(text, text, timestamptz, uuid, integer, date) to authenticated;
notify pgrst, 'reload schema';
commit;
