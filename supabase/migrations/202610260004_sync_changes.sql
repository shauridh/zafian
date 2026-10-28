-- Fase 3: sinkronisasi katalog dua arah (pull bertahap) + RPC atomik.
--
-- Desain singkat:
--   * Tabel master yang ikut sync mendapat `row_version` (monoton per baris).
--     Trigger BEFORE UPDATE menaikkan versi + `updated_at`.
--   * Setiap insert/update/delete (termasuk soft delete `deleted_at`) dicatat ke
--     `public.outlet_changes` lewat trigger AFTER, dengan `seq` identity global
--     yang monoton. Karena filter per outlet memakai `seq > since`, urutannya
--     juga monoton untuk setiap outlet.
--   * `pull_changes()` mengembalikan satu halaman + `next_seq` + `has_more`.
--   * `apply_sale()` menerapkan penjualan secara atomik dan idempoten.
--
-- Aplikasi tetap offline-first: pull/push hanya salinan, IndexedDB sumber lokal.

-- ---------------------------------------------------------------------------
-- 1. Versi baris untuk tabel master yang ikut sync
-- ---------------------------------------------------------------------------

alter table public.categories add column if not exists row_version bigint not null default 1;
alter table public.menus add column if not exists row_version bigint not null default 1;
alter table public.ingredients add column if not exists row_version bigint not null default 1;
alter table public.outlet_settings add column if not exists row_version bigint not null default 1;
alter table public.menu_recipes add column if not exists row_version bigint not null default 1;
alter table public.menu_recipes add column if not exists updated_at timestamptz not null default now();

create or replace function public.bump_row_version()
returns trigger
language plpgsql
as $$
begin
  new.row_version := coalesce(old.row_version, 0) + 1;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.bump_row_version() is
  'Trigger BEFORE UPDATE: menaikkan row_version dan updated_at untuk tabel yang ikut sync.';

-- ---------------------------------------------------------------------------
-- 2. Stream perubahan per outlet
-- ---------------------------------------------------------------------------

create table if not exists public.outlet_changes (
  seq bigint generated always as identity primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  entity text not null check (entity in ('category', 'menu', 'ingredient', 'menu_recipe', 'outlet_settings')),
  entity_id text not null,
  op text not null check (op in ('upsert', 'delete')),
  row_version bigint not null default 1,
  payload jsonb,
  device_id text,
  changed_at timestamptz not null default now()
);

create index if not exists outlet_changes_outlet_seq_idx
  on public.outlet_changes (outlet_id, seq);

alter table public.outlet_changes enable row level security;

drop policy if exists outlet_changes_member_read on public.outlet_changes;
create policy outlet_changes_member_read on public.outlet_changes
  for select to authenticated
  using (public.is_outlet_member(outlet_id));

-- Hanya baca. Penulisan dilakukan trigger security definer dan RPC, bukan klien.
revoke all on public.outlet_changes from anon, authenticated;
grant select on public.outlet_changes to authenticated;

create or replace function public.log_outlet_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := tg_argv[0];
  v_row jsonb;
  v_id text;
  v_outlet uuid;
  v_op text;
  v_version bigint;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_op := 'delete';
    v_version := coalesce(old.row_version, 0) + 1;
  else
    v_row := to_jsonb(new);
    v_op := case when (v_row ->> 'deleted_at') is not null then 'delete' else 'upsert' end;
    v_version := new.row_version;
  end if;

  if v_entity = 'menu_recipe' then
    v_id := (v_row ->> 'menu_id') || ':' || (v_row ->> 'ingredient_id');
  elsif v_entity = 'outlet_settings' then
    v_id := v_row ->> 'outlet_id';
  else
    v_id := v_row ->> 'id';
  end if;

  v_outlet := (v_row ->> 'outlet_id')::uuid;

  insert into public.outlet_changes (outlet_id, entity, entity_id, op, row_version, payload, device_id)
  values (v_outlet, v_entity, v_id, v_op, v_version, v_row, null);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.log_outlet_change() is
  'Trigger AFTER INSERT/UPDATE/DELETE: mencatat perubahan master ke outlet_changes.';

drop trigger if exists categories_row_version on public.categories;
create trigger categories_row_version before update on public.categories
  for each row execute function public.bump_row_version();
drop trigger if exists categories_change on public.categories;
create trigger categories_change after insert or update or delete on public.categories
  for each row execute function public.log_outlet_change('category');

drop trigger if exists menus_row_version on public.menus;
create trigger menus_row_version before update on public.menus
  for each row execute function public.bump_row_version();
drop trigger if exists menus_change on public.menus;
create trigger menus_change after insert or update or delete on public.menus
  for each row execute function public.log_outlet_change('menu');

drop trigger if exists ingredients_row_version on public.ingredients;
create trigger ingredients_row_version before update on public.ingredients
  for each row execute function public.bump_row_version();
drop trigger if exists ingredients_change on public.ingredients;
create trigger ingredients_change after insert or update or delete on public.ingredients
  for each row execute function public.log_outlet_change('ingredient');

drop trigger if exists menu_recipes_row_version on public.menu_recipes;
create trigger menu_recipes_row_version before update on public.menu_recipes
  for each row execute function public.bump_row_version();
drop trigger if exists menu_recipes_change on public.menu_recipes;
create trigger menu_recipes_change after insert or update or delete on public.menu_recipes
  for each row execute function public.log_outlet_change('menu_recipe');

drop trigger if exists outlet_settings_row_version on public.outlet_settings;
create trigger outlet_settings_row_version before update on public.outlet_settings
  for each row execute function public.bump_row_version();
drop trigger if exists outlet_settings_change on public.outlet_settings;
create trigger outlet_settings_change after insert or update or delete on public.outlet_settings
  for each row execute function public.log_outlet_change('outlet_settings');

-- ---------------------------------------------------------------------------
-- 3. RPC pull berhalaman
-- ---------------------------------------------------------------------------

create or replace function public.pull_changes(
  p_outlet uuid,
  p_since_seq bigint default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_page_size integer := greatest(1, least(500, coalesce(p_limit, 200)));
  v_changes jsonb;
  v_next bigint;
  v_more boolean;
begin
  if auth.uid() is null or p_outlet is null or not public.is_outlet_member(p_outlet) then
    raise exception 'akses outlet ditolak' using errcode = '42501';
  end if;

  with page as (
    select seq, outlet_id, entity, entity_id, op, row_version, payload, device_id, changed_at
    from public.outlet_changes
    where outlet_id = p_outlet and seq > coalesce(p_since_seq, 0)
    order by seq
    limit v_page_size
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by page.seq), '[]'::jsonb),
         coalesce(max(page.seq), coalesce(p_since_seq, 0))
    into v_changes, v_next
  from page;

  v_more := exists (
    select 1 from public.outlet_changes
    where outlet_id = p_outlet and seq > v_next
  );

  return jsonb_build_object(
    'changes', v_changes,
    'next_seq', v_next,
    'has_more', v_more,
    'page_size', v_page_size
  );
end;
$$;

comment on function public.pull_changes(uuid, bigint, integer) is
  'Halaman perubahan katalog untuk outlet; menolak non-member.';

-- ---------------------------------------------------------------------------
-- 4. RPC atomik + idempoten untuk penjualan
-- ---------------------------------------------------------------------------

create or replace function public.apply_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet uuid;
  v_tx jsonb := p_payload -> 'transaction';
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_id text;
  v_items_total numeric(14, 2) := 0;
  v_inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'sesi tidak valid' using errcode = '42501';
  end if;

  begin
    v_outlet := (p_payload ->> 'outlet_id')::uuid;
  exception when others then
    raise exception 'outlet tidak valid' using errcode = '22023';
  end;

  if v_outlet is null or not public.is_outlet_member(v_outlet) then
    raise exception 'akses outlet ditolak' using errcode = '42501';
  end if;

  if v_tx is null
     or coalesce(v_tx ->> 'id', '') = ''
     or coalesce(v_tx ->> 'shift_id', '') = ''
     or coalesce(v_tx ->> 'number', '') = '' then
    raise exception 'payload transaksi tidak lengkap' using errcode = '22023';
  end if;

  v_id := v_tx ->> 'id';

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'qty')::numeric), 0)
    into v_items_total
  from jsonb_array_elements(v_items) as item;

  if abs(v_items_total - coalesce((v_tx ->> 'subtotal')::numeric, 0)) > 0.01 then
    raise exception 'subtotal tidak cocok dengan item' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.shifts
    where id = v_tx ->> 'shift_id' and outlet_id = v_outlet
  ) then
    raise exception 'shift tidak ditemukan di outlet' using errcode = '23503';
  end if;

  insert into public.transactions (
    id, outlet_id, number, created_at, order_type, payment_method,
    subtotal, paid_amount, change_amount, status, note, status_reason,
    status_changed_at, shift_id, device_id, created_by
  ) values (
    v_id,
    v_outlet,
    v_tx ->> 'number',
    coalesce((v_tx ->> 'created_at')::timestamptz, now()),
    v_tx ->> 'order_type',
    v_tx ->> 'payment_method',
    (v_tx ->> 'subtotal')::numeric,
    coalesce((v_tx ->> 'paid_amount')::numeric, 0),
    coalesce((v_tx ->> 'change_amount')::numeric, 0),
    coalesce(v_tx ->> 'status', 'completed'),
    nullif(v_tx ->> 'note', ''),
    nullif(v_tx ->> 'status_reason', ''),
    nullif(v_tx ->> 'status_changed_at', '')::timestamptz,
    v_tx ->> 'shift_id',
    nullif(p_payload ->> 'device_id', ''),
    auth.uid()
  )
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'transaction_id', v_id,
      'items', 0
    );
  end if;

  insert into public.transaction_items (
    id, outlet_id, transaction_id, line_no, menu_id, name, category, price, qty, emoji, image_url
  )
  select
    coalesce(nullif(item ->> 'id', ''), v_id || '-item-' || ordinality::text),
    v_outlet,
    v_id,
    ordinality::integer,
    nullif(item ->> 'menu_id', ''),
    item ->> 'name',
    item ->> 'category',
    (item ->> 'price')::numeric,
    (item ->> 'qty')::numeric,
    nullif(item ->> 'emoji', ''),
    nullif(item ->> 'image_url', '')
  from jsonb_array_elements(v_items) with ordinality as t(item, ordinality)
  on conflict (id) do nothing;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'transaction_id', v_id,
    'items', jsonb_array_length(v_items)
  );
end;
$$;

comment on function public.apply_sale(jsonb) is
  'Menerapkan satu penjualan secara atomik; ID sama = idempoten, payload tidak valid ditolak.';

-- ---------------------------------------------------------------------------
-- 5. Grant RPC (bukan akses tabel langsung)
-- ---------------------------------------------------------------------------

revoke all on function public.pull_changes(uuid, bigint, integer) from public, anon;
revoke all on function public.apply_sale(jsonb) from public, anon;
grant execute on function public.pull_changes(uuid, bigint, integer) to authenticated;
grant execute on function public.apply_sale(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Realtime: ikutkan stream ke publikasi bawaan Supabase
-- ---------------------------------------------------------------------------
-- Supabase Realtime hanya mengirim `postgres_changes` untuk tabel yang terdaftar
-- di publikasi `supabase_realtime`. Blok ini idempoten dan dilewati tanpa error
-- di Postgres biasa (PGlite/CI) yang tidak punya publikasi tersebut.

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'outlet_changes'
     ) then
    alter publication supabase_realtime add table public.outlet_changes;
  end if;
end;
$realtime$;
