-- Sabana POS — RLS berbasis outlet.
-- Aturan: staf hanya melihat data outletnya; hanya pemilik (role 'owner') yang
-- boleh menulis master data dan pengaturan. Kasir boleh menulis data operasional.

create or replace function public.is_outlet_member(target_outlet uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where user_id = auth.uid() and outlet_id = target_outlet
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
    select 1 from public.staff
    where user_id = auth.uid() and outlet_id = target_outlet and role = 'owner'
  );
$$;

revoke all on function public.is_outlet_member(uuid) from public;
revoke all on function public.is_outlet_owner(uuid) from public;
grant execute on function public.is_outlet_member(uuid) to authenticated;
grant execute on function public.is_outlet_owner(uuid) to authenticated;
revoke all on function public.create_outlet(text) from public;
grant execute on function public.create_outlet(text) to authenticated;

alter table public.outlets enable row level security;
alter table public.staff enable row level security;
alter table public.app_settings enable row level security;
alter table public.menu_categories enable row level security;
alter table public.ingredient_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.ingredients enable row level security;
alter table public.stock_movements enable row level security;
alter table public.shifts enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.pos_documents enable row level security;

/* Outlet ------------------------------------------------------------------ */

create policy outlets_member_select on public.outlets
  for select to authenticated
  using (public.is_outlet_member(id));

create policy outlets_owner_update on public.outlets
  for update to authenticated
  using (public.is_outlet_owner(id))
  with check (public.is_outlet_owner(id));

/* Staf -------------------------------------------------------------------- */

create policy staff_self_or_owner_select on public.staff
  for select to authenticated
  using (user_id = auth.uid() or public.is_outlet_owner(outlet_id));

create policy staff_owner_insert on public.staff
  for insert to authenticated
  with check (public.is_outlet_owner(outlet_id));

create policy staff_owner_update on public.staff
  for update to authenticated
  using (public.is_outlet_owner(outlet_id))
  with check (public.is_outlet_owner(outlet_id));

create policy staff_owner_delete on public.staff
  for delete to authenticated
  using (public.is_outlet_owner(outlet_id));

/* Master data: baca untuk anggota, tulis untuk pemilik --------------------- */

create policy app_settings_member_select on public.app_settings
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy app_settings_owner_write on public.app_settings
  for insert to authenticated with check (public.is_outlet_owner(outlet_id));
create policy app_settings_owner_update on public.app_settings
  for update to authenticated using (public.is_outlet_owner(outlet_id)) with check (public.is_outlet_owner(outlet_id));

create policy menu_categories_member_select on public.menu_categories
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy menu_categories_owner_insert on public.menu_categories
  for insert to authenticated with check (public.is_outlet_owner(outlet_id));
create policy menu_categories_owner_update on public.menu_categories
  for update to authenticated using (public.is_outlet_owner(outlet_id)) with check (public.is_outlet_owner(outlet_id));
create policy menu_categories_owner_delete on public.menu_categories
  for delete to authenticated using (public.is_outlet_owner(outlet_id));

create policy ingredient_categories_member_select on public.ingredient_categories
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy ingredient_categories_owner_insert on public.ingredient_categories
  for insert to authenticated with check (public.is_outlet_owner(outlet_id));
create policy ingredient_categories_owner_update on public.ingredient_categories
  for update to authenticated using (public.is_outlet_owner(outlet_id)) with check (public.is_outlet_owner(outlet_id));
create policy ingredient_categories_owner_delete on public.ingredient_categories
  for delete to authenticated using (public.is_outlet_owner(outlet_id));

create policy menu_items_member_select on public.menu_items
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy menu_items_owner_insert on public.menu_items
  for insert to authenticated with check (public.is_outlet_owner(outlet_id));
create policy menu_items_owner_update on public.menu_items
  for update to authenticated using (public.is_outlet_owner(outlet_id)) with check (public.is_outlet_owner(outlet_id));
create policy menu_items_owner_delete on public.menu_items
  for delete to authenticated using (public.is_outlet_owner(outlet_id));

create policy ingredients_member_select on public.ingredients
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy ingredients_owner_insert on public.ingredients
  for insert to authenticated with check (public.is_outlet_owner(outlet_id));
create policy ingredients_owner_update on public.ingredients
  for update to authenticated using (public.is_outlet_owner(outlet_id)) with check (public.is_outlet_owner(outlet_id));
create policy ingredients_owner_delete on public.ingredients
  for delete to authenticated using (public.is_outlet_owner(outlet_id));

/* Operasional: anggota boleh menulis, hapus hanya pemilik ------------------ */

create policy stock_movements_member_select on public.stock_movements
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy stock_movements_member_insert on public.stock_movements
  for insert to authenticated with check (public.is_outlet_member(outlet_id));
create policy stock_movements_owner_update on public.stock_movements
  for update to authenticated using (public.is_outlet_owner(outlet_id)) with check (public.is_outlet_owner(outlet_id));
create policy stock_movements_owner_delete on public.stock_movements
  for delete to authenticated using (public.is_outlet_owner(outlet_id));

create policy shifts_member_select on public.shifts
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy shifts_member_insert on public.shifts
  for insert to authenticated with check (public.is_outlet_member(outlet_id));
create policy shifts_member_update on public.shifts
  for update to authenticated using (public.is_outlet_member(outlet_id)) with check (public.is_outlet_member(outlet_id));

create policy transactions_member_select on public.transactions
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy transactions_member_insert on public.transactions
  for insert to authenticated with check (public.is_outlet_member(outlet_id));
create policy transactions_member_update on public.transactions
  for update to authenticated using (public.is_outlet_member(outlet_id)) with check (public.is_outlet_member(outlet_id));
create policy transactions_owner_delete on public.transactions
  for delete to authenticated using (public.is_outlet_owner(outlet_id));

create policy transaction_items_member_select on public.transaction_items
  for select to authenticated using (public.is_outlet_member(outlet_id));

create policy pos_documents_member_select on public.pos_documents
  for select to authenticated using (public.is_outlet_member(outlet_id));
create policy pos_documents_member_insert on public.pos_documents
  for insert to authenticated with check (public.is_outlet_member(outlet_id));
create policy pos_documents_member_update on public.pos_documents
  for update to authenticated using (public.is_outlet_member(outlet_id)) with check (public.is_outlet_member(outlet_id));

/* Hak tabel: hanya authenticated; anon tidak boleh menyentuh data outlet. */

revoke all on public.outlets, public.staff, public.app_settings, public.menu_categories,
  public.ingredient_categories, public.menu_items, public.ingredients, public.stock_movements,
  public.shifts, public.transactions, public.transaction_items, public.pos_documents from anon;

grant select, insert, update, delete on public.outlets, public.staff, public.app_settings,
  public.menu_categories, public.ingredient_categories, public.menu_items, public.ingredients,
  public.stock_movements, public.shifts, public.transactions, public.transaction_items,
  public.pos_documents to authenticated;
