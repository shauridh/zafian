-- Migration awal Sabana POS untuk Supabase staging.
-- Sumber: docs/superpowers/specs/2026-10-26-supabase-sync-design.md (blok DDL bagian 5), diekstrak apa adanya.
-- Jalankan lewat Supabase CLI: supabase db push (setelah project di-link).

-- Prasyarat Supabase: schema auth dan role authenticated sudah ada.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Identitas dan pengaturan
-- ---------------------------------------------------------------------------

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Jakarta',
  currency text not null default 'IDR',
  created_at timestamptz not null default now()
);

create table public.outlet_members (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'cashier')),
  created_at timestamptz not null default now(),
  primary key (outlet_id, user_id)
);

create table public.outlet_settings (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  business_name text not null default 'SABANA FRIED CHICKEN',
  outlet_name text not null default 'Outlet utama',
  receipt_footer text not null default 'Terima kasih • Sabana POS',
  paper_width smallint not null default 58 check (paper_width in (58, 80)),
  header_align text not null default 'left' check (header_align in ('left', 'center')),
  footer_align text not null default 'left' check (footer_align in ('left', 'center')),
  font_size text not null default 'normal' check (font_size in ('compact', 'normal', 'large')),
  show_order_type boolean not null default true,
  show_payment_detail boolean not null default true,
  copies smallint not null default 1 check (copies between 1 and 3),
  app_schema_version integer not null default 6,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table public.outlet_counters (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  next_transaction_number bigint not null default 274 check (next_transaction_number > 0)
);

-- ---------------------------------------------------------------------------
-- Katalog
-- ---------------------------------------------------------------------------

create table public.categories (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, outlet_id)
);

create unique index categories_outlet_name_uq
  on public.categories (outlet_id, lower(name))
  where deleted_at is null;

create table public.menus (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category_id text not null,
  name text not null,
  price numeric(14, 2) not null check (price >= 0),
  emoji text not null default '',
  image_url text,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, outlet_id),
  foreign key (category_id, outlet_id) references public.categories (id, outlet_id)
);

create table public.ingredients (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null,
  unit text not null,
  cost_per_unit numeric(14, 4) not null check (cost_per_unit >= 0),
  purchase_unit text not null default '',
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  usage_per_purchase_unit numeric(14, 3) not null default 1 check (usage_per_purchase_unit > 0),
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, outlet_id)
);

create table public.menu_recipes (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  menu_id text not null,
  ingredient_id text not null,
  qty numeric(14, 3) not null check (qty > 0),
  primary key (outlet_id, menu_id, ingredient_id),
  foreign key (menu_id, outlet_id) references public.menus (id, outlet_id) on delete cascade,
  foreign key (ingredient_id, outlet_id) references public.ingredients (id, outlet_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Operasional
-- ---------------------------------------------------------------------------

create table public.shifts (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_float numeric(14, 2) not null default 350000 check (opening_float >= 0),
  actual_cash numeric(14, 2) check (actual_cash >= 0),
  status text not null check (status in ('open', 'closed')),
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  device_id text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, outlet_id)
);

create unique index shifts_one_open_per_outlet
  on public.shifts (outlet_id)
  where status = 'open';

create table public.transactions (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  number text not null,
  created_at timestamptz not null,
  order_type text not null check (order_type in ('Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood')),
  payment_method text not null check (payment_method in ('Cash', 'QRIS', 'Unpaid')),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  change_amount numeric(14, 2) not null default 0 check (change_amount >= 0),
  status text not null check (status in ('completed', 'cancelled', 'refunded')),
  note text,
  status_reason text,
  status_changed_at timestamptz,
  shift_id text not null,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at_server timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, number),
  unique (id, outlet_id),
  foreign key (shift_id, outlet_id) references public.shifts (id, outlet_id) on delete restrict
);

create table public.transaction_items (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  transaction_id text not null,
  line_no integer not null check (line_no > 0),
  menu_id text,
  name text not null,
  category text not null,
  price numeric(14, 2) not null check (price >= 0),
  qty numeric(14, 3) not null check (qty > 0),
  emoji text,
  image_url text,
  unique (transaction_id, line_no),
  foreign key (transaction_id, outlet_id) references public.transactions (id, outlet_id) on delete restrict
);

create table public.cash_movements (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  shift_id text not null,
  type text not null check (type in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  note text not null,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  created_at_server timestamptz not null default now(),
  foreign key (shift_id, outlet_id) references public.shifts (id, outlet_id) on delete restrict
);

create table public.stock_movements (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  ingredient_id text not null,
  type text not null check (type in ('purchase', 'adjustment', 'opname')),
  qty numeric(14, 3) not null,
  total_cost numeric(14, 2) not null default 0 check (total_cost >= 0),
  note text not null default '',
  unit_cost numeric(14, 4) check (unit_cost >= 0),
  counted_qty numeric(14, 3),
  system_qty numeric(14, 3),
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  created_at_server timestamptz not null default now(),
  foreign key (ingredient_id, outlet_id) references public.ingredients (id, outlet_id) on delete restrict
);

create table public.expenses (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category text not null check (category in ('Bahan', 'Gaji', 'Sewa', 'Listrik & air', 'Internet', 'Transportasi', 'Perawatan', 'Platform', 'Lain-lain')),
  amount numeric(14, 2) not null check (amount > 0),
  note text not null default '',
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  created_at_server timestamptz not null default now()
);

create table public.preorders (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  customer_name text not null,
  pickup_at timestamptz not null,
  order_type text not null check (order_type in ('Takeaway', 'Dine in', 'GoFood', 'GrabFood', 'ShopeeFood')),
  total numeric(14, 2) not null check (total >= 0),
  dp numeric(14, 2) not null default 0 check (dp >= 0),
  payment_method text not null check (payment_method in ('Cash', 'QRIS', 'Unpaid')),
  status text not null check (status in ('draft', 'dp_received', 'processing', 'completed', 'cancelled')),
  note text,
  transaction_id text,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (dp <= total),
  unique (id, outlet_id),
  foreign key (transaction_id, outlet_id) references public.transactions (id, outlet_id) on delete restrict
);

create table public.preorder_items (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  preorder_id text not null,
  line_no integer not null check (line_no > 0),
  menu_id text,
  name text not null,
  category text not null,
  price numeric(14, 2) not null check (price >= 0),
  qty numeric(14, 3) not null check (qty > 0),
  emoji text,
  image_url text,
  unique (preorder_id, line_no),
  foreign key (preorder_id, outlet_id) references public.preorders (id, outlet_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Akuntansi dan audit
-- ---------------------------------------------------------------------------

create table public.accounts (
  code text primary key,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense'))
);

create table public.journal_entries (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  date timestamptz not null,
  description text not null,
  source_type text not null check (source_type in ('sale', 'cogs', 'cash', 'purchase', 'opname', 'expense')),
  source_id text not null,
  posted_at timestamptz not null default now(),
  unique (outlet_id, source_type, source_id)
);

create table public.journal_lines (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  entry_id text not null references public.journal_entries(id) on delete cascade,
  account_code text not null references public.accounts(code),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0)
);

create table public.audit_log (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  detail text not null default '',
  entity_type text,
  entity_id text,
  device_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Backup dan idempotensi sync
-- ---------------------------------------------------------------------------

create table public.outlet_snapshots (
  id text primary key,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  schema_version integer not null,
  reason text not null check (reason in ('daily', 'before-shift-close', 'manual', 'legacy')),
  created_at timestamptz not null,
  device_id text,
  checksum text not null,
  storage_path text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0)
);

create table public.sync_mutations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  device_id text not null,
  client_seq bigint not null,
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  payload_hash text not null,
  applied_at timestamptz not null default now(),
  result jsonb,
  check (client_seq > 0),
  unique (outlet_id, device_id, client_seq)
);

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

create index categories_outlet_idx on public.categories (outlet_id, sort_order) where deleted_at is null;
create index menus_outlet_idx on public.menus (outlet_id, category_id) where deleted_at is null;
create index ingredients_outlet_idx on public.ingredients (outlet_id) where deleted_at is null;
create index transactions_outlet_created_idx on public.transactions (outlet_id, created_at desc);
create index transactions_shift_idx on public.transactions (outlet_id, shift_id);
create index transactions_status_idx on public.transactions (outlet_id, status);
create index transaction_items_transaction_idx on public.transaction_items (transaction_id);
create index cash_movements_shift_idx on public.cash_movements (outlet_id, shift_id);
create index stock_movements_outlet_created_idx on public.stock_movements (outlet_id, created_at desc);
create index stock_movements_ingredient_idx on public.stock_movements (outlet_id, ingredient_id);
create index expenses_outlet_created_idx on public.expenses (outlet_id, created_at desc);
create index preorders_outlet_pickup_idx on public.preorders (outlet_id, pickup_at) where status not in ('completed', 'cancelled');
create index journal_entries_outlet_date_idx on public.journal_entries (outlet_id, date);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index audit_log_outlet_created_idx on public.audit_log (outlet_id, created_at desc);
create index sync_mutations_outlet_idx on public.sync_mutations (outlet_id, applied_at);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

create trigger categories_touch before update on public.categories
for each row execute function public.touch_row();
create trigger menus_touch before update on public.menus
for each row execute function public.touch_row();
create trigger ingredients_touch before update on public.ingredients
for each row execute function public.touch_row();
create trigger shifts_touch before update on public.shifts
for each row execute function public.touch_row();
create trigger transactions_touch before update on public.transactions
for each row execute function public.touch_row();
create trigger preorders_touch before update on public.preorders
for each row execute function public.touch_row();
create trigger outlet_settings_touch before update on public.outlet_settings
for each row execute function public.touch_row();

-- ---------------------------------------------------------------------------
-- Chart of accounts awal
-- ---------------------------------------------------------------------------

insert into public.accounts (code, name, type) values
  ('1000', 'Kas Kasir', 'asset'),
  ('1100', 'Piutang QRIS', 'asset'),
  ('1150', 'Piutang Platform & Pelanggan', 'asset'),
  ('1200', 'Persediaan Bahan', 'asset'),
  ('2000', 'DP Pelanggan', 'liability'),
  ('3000', 'Modal Pemilik', 'equity'),
  ('3100', 'Setoran Pemilik', 'equity'),
  ('3200', 'Prive Pemilik', 'equity'),
  ('4000', 'Penjualan', 'revenue'),
  ('5000', 'Harga Pokok Penjualan', 'expense'),
  ('6000', 'Beban Operasional', 'expense'),
  ('6100', 'Selisih Persediaan', 'expense'),
  ('6900', 'Selisih Kas', 'expense')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Hak tabel minimum. RLS tetap membatasi baris yang boleh dibaca/ditulis.
-- Sesuaikan jika project memakai default privileges Supabase yang berbeda.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

grant select on public.outlets, public.outlet_members,
  public.outlet_settings, public.categories, public.menus, public.ingredients,
  public.menu_recipes, public.shifts, public.transactions,
  public.transaction_items, public.cash_movements, public.stock_movements,
  public.expenses, public.preorders, public.preorder_items, public.accounts,
  public.journal_entries, public.journal_lines, public.audit_log,
  public.outlet_snapshots
  to authenticated;

grant insert, update, delete on public.outlet_members to authenticated;
grant update on public.outlets to authenticated;
grant insert, update on public.outlet_settings to authenticated;
grant insert, update on public.categories, public.menus, public.ingredients to authenticated;
grant insert, update, delete on public.menu_recipes to authenticated;
grant insert on public.outlet_snapshots to authenticated;
-- Mutasi transaksi, kas, shift, stok, expense, preorder, jurnal, dan audit
-- tidak diberi grant tulis langsung. Semua lewat RPC security definer.
