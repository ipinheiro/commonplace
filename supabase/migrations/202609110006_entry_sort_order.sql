begin;

drop function api.list_entries(text, text, timestamptz, uuid, integer, date, text);
create function api.list_entries(
    p_query text default '',
    p_kind text default null,
    p_before_created timestamptz default null,
    p_before_id uuid default null,
    p_limit integer default 30,
    p_before_date date default null,
    p_space text default 'personal',
    p_order text default 'newest'
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    v_items jsonb;
    v_cursor jsonb := null;
    v_before_date date := p_before_date;
begin
    if p_order is null or p_order not in ('newest', 'oldest')
        or p_space is null or p_space not in ('personal', 'work')
        or p_limit is null or p_limit not between 1 and 100
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
        order by case when p_order = 'oldest' then app.entry_date(e) end asc,
        case when p_order = 'oldest' then e.created_at end asc,
        case when p_order = 'oldest' then e.id end asc,
        app.entry_date(e) desc, e.created_at desc, e.id desc), '[]')
    into v_items
    from (
        select e.* from app.entries e
        where e.owner_id = auth.uid() and e.deleted_at is null
            and coalesce(e.metadata->>'space', 'personal') = p_space
            and (p_kind is null or e.kind = p_kind)
            and (btrim(p_query) = '' or e.search_document @@ websearch_to_tsquery('simple', p_query))
            and (p_before_created is null
                or (p_order = 'newest' and (app.entry_date(e), e.created_at, e.id)
                    < (v_before_date, p_before_created, p_before_id))
                or (p_order = 'oldest' and (app.entry_date(e), e.created_at, e.id)
                    > (v_before_date, p_before_created, p_before_id)))
        order by case when p_order = 'oldest' then app.entry_date(e) end asc,
        case when p_order = 'oldest' then e.created_at end asc,
        case when p_order = 'oldest' then e.id end asc,
        app.entry_date(e) desc, e.created_at desc, e.id desc
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
revoke all on function api.list_entries(text, text, timestamptz, uuid, integer, date, text, text) from public, anon;
grant execute on function api.list_entries(text, text, timestamptz, uuid, integer, date, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
