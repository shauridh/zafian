-- RLS lengkap untuk semua tabel yang diberi grant SELECT ke role authenticated.
-- Dokumen desain hanya memuat contoh policy untuk sebagian tabel dan meminta
-- pola yang sama diulang; migration ini melengkapinya sesuai matriks akses.

-- ---------------------------------------------------------------------------
-- Helper membership (security definer agar tidak rekursif ke RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_outlet_member(target_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.outlet_members m
    where m.outlet_id = target_outlet
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_outlet_owner(target_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.outlet_members m
    where m.outlet_id = target_outlet
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

-- Helper untuk tabel anak: cek membership lewat parent tanpa memicu RLS parent.
create or replace function public.can_read_transaction(target_transaction text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.transactions t
    where t.id = target_transaction
      and public.is_outlet_member(t.outlet_id)
  );
$$;

create or replace function public.can_read_preorder(target_preorder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.preorders p
    where p.id = target_preorder
      and public.is_outlet_member(p.outlet_id)
  );
$$;

create or replace function public.can_read_journal_entry(target_entry text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.journal_entries e
    where e.id = target_entry
      and public.is_outlet_owner(e.outlet_id)
  );
$$;

revoke all on function public.is_outlet_member(uuid) from public;
revoke all on function public.is_outlet_owner(uuid) from public;
revoke all on function public.can_read_transaction(text) from public;
revoke all on function public.can_read_preorder(text) from public;
revoke all on function public.can_read_journal_entry(text) from public;
grant execute on function public.is_outlet_member(uuid) to authenticated;
grant execute on function public.is_outlet_owner(uuid) to authenticated;
grant execute on function public.can_read_transaction(text) to authenticated;
grant execute on function public.can_read_preorder(text) to authenticated;
grant execute on function public.can_read_journal_entry(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Identitas dan pengaturan
-- ---------------------------------------------------------------------------

alter table public.outlets enable row level security;
create policy outlets_member_read on public.outlets
  for select to authenticated
  using (public.is_outlet_member(id));
create policy outlets_owner_update on public.outlets
  for update to authenticated
  using (public.is_outlet_owner(id))
  with check (public.is_outlet_owner(id));

alter table public.outlet_members enable row level security;
create policy members_read_self_or_owner on public.outlet_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_outlet_owner(outlet_id));
create policy members_owner_insert on public.outlet_members
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));
create policy members_owner_update on public.outlet_members
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));
create policy members_owner_delete on public.outlet_members
  for delete to authenticated
  using (public.is_outlet_owner(outlet_id));

alter table public.outlet_settings enable row level security;
create policy settings_member_read on public.outlet_settings
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy settings_owner_update on public.outlet_settings
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

-- Counter hanya untuk service role/RPC; tidak ada grant ke authenticated.
alter table public.outlet_counters enable row level security;

-- ---------------------------------------------------------------------------
-- Katalog
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
create policy categories_member_read on public.categories
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy categories_owner_insert on public.categories
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));
create policy categories_owner_update on public.categories
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

alter table public.menus enable row level security;
create policy menus_member_read on public.menus
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy menus_owner_insert on public.menus
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));
create policy menus_owner_update on public.menus
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

alter table public.ingredients enable row level security;
create policy ingredients_member_read on public.ingredients
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy ingredients_owner_insert on public.ingredients
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));
create policy ingredients_owner_update on public.ingredients
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

alter table public.menu_recipes enable row level security;
create policy recipes_member_read on public.menu_recipes
  for select to authenticated
  using (public.is_outlet_member(outlet_id));
create policy recipes_owner_write on public.menu_recipes
  for all to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

-- ---------------------------------------------------------------------------
-- Operasional (semua tulis lewat RPC security definer)
-- ---------------------------------------------------------------------------

alter table public.shifts enable row level security;
create policy shifts_member_read on public.shifts
  for select to authenticated
  using (public.is_outlet_member(outlet_id));

alter table public.transactions enable row level security;
create policy transactions_member_read on public.transactions
  for select to authenticated
  using (public.is_outlet_member(outlet_id));

alter table public.transaction_items enable row level security;
create policy transaction_items_member_read on public.transaction_items
  for select to authenticated
  using (public.can_read_transaction(transaction_id));

alter table public.cash_movements enable row level security;
create policy cash_movements_member_read on public.cash_movements
  for select to authenticated
  using (public.is_outlet_member(outlet_id));

alter table public.stock_movements enable row level security;
create policy stock_movements_owner_read on public.stock_movements
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));

alter table public.expenses enable row level security;
create policy expenses_owner_read on public.expenses
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));

alter table public.preorders enable row level security;
create policy preorders_member_read on public.preorders
  for select to authenticated
  using (public.is_outlet_member(outlet_id));

alter table public.preorder_items enable row level security;
create policy preorder_items_member_read on public.preorder_items
  for select to authenticated
  using (public.can_read_preorder(preorder_id));

-- ---------------------------------------------------------------------------
-- Akuntansi dan audit (owner-only)
-- ---------------------------------------------------------------------------

alter table public.accounts enable row level security;
create policy accounts_authenticated_read on public.accounts
  for select to authenticated
  using (true);

alter table public.journal_entries enable row level security;
create policy journal_entries_owner_read on public.journal_entries
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));

alter table public.journal_lines enable row level security;
create policy journal_lines_owner_read on public.journal_lines
  for select to authenticated
  using (public.can_read_journal_entry(entry_id));

alter table public.audit_log enable row level security;
create policy audit_log_owner_read on public.audit_log
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));

-- ---------------------------------------------------------------------------
-- Backup dan idempotensi
-- ---------------------------------------------------------------------------

alter table public.outlet_snapshots enable row level security;
create policy snapshots_owner_read on public.outlet_snapshots
  for select to authenticated
  using (public.is_outlet_owner(outlet_id));
create policy snapshots_owner_insert on public.outlet_snapshots
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));

alter table public.sync_mutations enable row level security;
-- Tidak ada policy: hanya service role / RPC security definer yang menyentuh tabel ini.
