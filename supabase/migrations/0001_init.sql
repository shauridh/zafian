-- Sabana POS — skema awal (online-only).
-- Semua tabel operasional memakai outlet_id dan RLS di 0002_rls.sql.
-- Jalankan migration ini SEBELUM 0002_rls.sql.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

/* -------------------------------------------------------------------------- */
/* Outlet & staf                                                              */
/* -------------------------------------------------------------------------- */

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'cashier')),
  display_name text not null default 'Pemilik',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_outlet_idx on public.staff (outlet_id);

-- Satu baris per outlet: preferensi aplikasi + nomor transaksi berikutnya.
create table public.app_settings (
  outlet_id uuid primary key references public.outlets (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  next_transaction_number integer not null default 274 check (next_transaction_number > 0),
  updated_at timestamptz not null default now()
);

/* -------------------------------------------------------------------------- */
/* Master data                                                                */
/* -------------------------------------------------------------------------- */

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, name)
);

create index menu_categories_outlet_idx on public.menu_categories (outlet_id);

create table public.ingredient_categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, name)
);

create index ingredient_categories_outlet_idx on public.ingredient_categories (outlet_id);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'Lainnya',
  price numeric(14, 2) not null default 0 check (price >= 0),
  emoji text not null default '🍽️',
  image_url text,
  active boolean not null default true,
  recipe jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_items_outlet_idx on public.menu_items (outlet_id);
create index menu_items_category_idx on public.menu_items (outlet_id, category);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'Lainnya',
  unit text not null default 'unit',
  cost_per_unit numeric(14, 4) not null default 0 check (cost_per_unit >= 0),
  purchase_unit text not null default 'unit',
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  usage_per_purchase_unit numeric(14, 4) not null default 1 check (usage_per_purchase_unit > 0),
  min_stock numeric(14, 4) not null default 0 check (min_stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredients_outlet_idx on public.ingredients (outlet_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  type text not null check (type in ('purchase', 'adjustment', 'opname')),
  qty numeric(14, 4) not null,
  total_cost numeric(14, 2) not null default 0 check (total_cost >= 0),
  note text not null default '',
  unit_cost numeric(14, 4),
  counted_qty numeric(14, 4),
  system_qty numeric(14, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stock_movements_outlet_idx on public.stock_movements (outlet_id, created_at desc);
create index stock_movements_ingredient_idx on public.stock_movements (ingredient_id);

/* -------------------------------------------------------------------------- */
/* Operasional harian                                                         */
/* -------------------------------------------------------------------------- */

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_float numeric(14, 2) not null default 0 check (opening_float >= 0),
  actual_cash numeric(14, 2),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shifts_outlet_idx on public.shifts (outlet_id, status);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  shift_id uuid references public.shifts (id) on delete set null,
  number text not null,
  created_at timestamptz not null,
  order_type text not null check (order_type in ('Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood')),
  payment_method text not null check (payment_method in ('Cash', 'QRIS', 'Unpaid')),
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  change_due numeric(14, 2) not null default 0 check (change_due >= 0),
  status text not null default 'completed' check (status in ('completed', 'cancelled', 'refunded')),
  note text,
  status_reason text,
  status_changed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (outlet_id, number)
);

create index transactions_outlet_created_idx on public.transactions (outlet_id, created_at desc);
create index transactions_shift_idx on public.transactions (shift_id);

-- Baris item dinormalisasi dari kolom transactions.items oleh trigger di bawah
-- agar laporan bisa query SQL tanpa bergantung pada bentuk JSON aplikasi.
create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  menu_id text not null,
  name text not null,
  category text not null default 'Lainnya',
  price numeric(14, 2) not null default 0,
  qty numeric(14, 4) not null default 0,
  emoji text,
  image_url text
);

create index transaction_items_transaction_idx on public.transaction_items (transaction_id);
create index transaction_items_outlet_idx on public.transaction_items (outlet_id);

create or replace function public.sync_transaction_items()
returns trigger
language plpgsql
as $$
begin
  delete from public.transaction_items where transaction_id = new.id;
  insert into public.transaction_items (outlet_id, transaction_id, menu_id, name, category, price, qty, emoji, image_url)
  select
    new.outlet_id,
    new.id,
    coalesce(item ->> 'id', ''),
    coalesce(item ->> 'name', 'Menu'),
    coalesce(item ->> 'category', 'Lainnya'),
    coalesce((item ->> 'price')::numeric, 0),
    coalesce((item ->> 'qty')::numeric, 0),
    item ->> 'emoji',
    item ->> 'imageUrl'
  from jsonb_array_elements(new.items) as item
  where coalesce(item ->> 'qty', '0')::numeric > 0;
  return new;
end;
$$;

create trigger transactions_sync_items
after insert or update of items on public.transactions
for each row execute function public.sync_transaction_items();

/* -------------------------------------------------------------------------- */
/* Dokumen pendukung (array kecil yang tidak butuh tabel sendiri)              */
/* -------------------------------------------------------------------------- */

create table public.pos_documents (
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  key text not null check (key in ('held_orders', 'pre_orders', 'cash_movements', 'expenses', 'audit_log')),
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (outlet_id, key)
);

/* -------------------------------------------------------------------------- */
/* Trigger updated_at                                                          */
/* -------------------------------------------------------------------------- */

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'outlets', 'staff', 'menu_categories', 'ingredient_categories', 'menu_items', 'ingredients',
    'stock_movements', 'shifts', 'transactions'
  ] loop
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', table_name, table_name);
  end loop;
end;
$$;

/* -------------------------------------------------------------------------- */
/* Onboarding: buat outlet + daftarkan pemilik yang sedang login              */
/* -------------------------------------------------------------------------- */

create or replace function public.create_outlet(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Harus masuk terlebih dahulu';
  end if;

  if exists (select 1 from public.staff where user_id = auth.uid()) then
    select outlet_id into v_outlet from public.staff where user_id = auth.uid() limit 1;
    return v_outlet;
  end if;

  v_email := coalesce(auth.jwt() ->> 'email', null);

  insert into public.outlets (name)
  values (coalesce(nullif(trim(p_name), ''), 'Outlet utama'))
  returning id into v_outlet;

  insert into public.staff (user_id, outlet_id, role, display_name, email)
  values (auth.uid(), v_outlet, 'owner', coalesce(v_email, 'Pemilik'), v_email);

  insert into public.app_settings (outlet_id) values (v_outlet);

  return v_outlet;
end;
$$;
