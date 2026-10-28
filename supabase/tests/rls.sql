-- Uji RLS lokal setelah seed + rls-fixtures.
-- Gagal bila satu assertion tidak sesuai: exception menghentikan eksekusi.

-- ---------------------------------------------------------------------------
-- Owner outlet A melihat seluruh data outletnya
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);
set role authenticated;
do $test$
declare v bigint;
begin
  select count(*) into v from public.outlets; if v <> 1 then raise exception 'owner A outlets % != 1', v; end if;
  select count(*) into v from public.outlet_settings; if v <> 1 then raise exception 'owner A settings % != 1', v; end if;
  select count(*) into v from public.outlet_members; if v <> 2 then raise exception 'owner A members % != 2', v; end if;
  select count(*) into v from public.categories; if v <> 5 then raise exception 'owner A categories % != 5', v; end if;
  select count(*) into v from public.menus; if v <> 11 then raise exception 'owner A menus % != 11', v; end if;
  select count(*) into v from public.ingredients; if v <> 23 then raise exception 'owner A ingredients % != 23', v; end if;
  select count(*) into v from public.menu_recipes; if v <> 69 then raise exception 'owner A recipes % != 69', v; end if;
  select count(*) into v from public.shifts; if v <> 2 then raise exception 'owner A shifts % != 2', v; end if;
  select count(*) into v from public.transactions; if v <> 4 then raise exception 'owner A transactions % != 4', v; end if;
  select count(*) into v from public.transaction_items; if v <> 5 then raise exception 'owner A transaction_items % != 5', v; end if;
  select count(*) into v from public.cash_movements; if v <> 3 then raise exception 'owner A cash % != 3', v; end if;
  select count(*) into v from public.stock_movements; if v <> 2 then raise exception 'owner A stock % != 2', v; end if;
  select count(*) into v from public.expenses; if v <> 1 then raise exception 'owner A expenses % != 1', v; end if;
  select count(*) into v from public.preorders; if v <> 1 then raise exception 'owner A preorders % != 1', v; end if;
  select count(*) into v from public.preorder_items; if v <> 1 then raise exception 'owner A preorder_items % != 1', v; end if;
  select count(*) into v from public.accounts; if v <> 13 then raise exception 'owner A accounts % != 13', v; end if;
  select count(*) into v from public.journal_entries; if v <> 14 then raise exception 'owner A journal_entries % != 14', v; end if;
  select count(*) into v from public.journal_lines; if v <> 28 then raise exception 'owner A journal_lines % != 28', v; end if;
  select count(*) into v from public.audit_log; if v <> 3 then raise exception 'owner A audit % != 3', v; end if;

  update public.outlet_settings set receipt_footer = receipt_footer where outlet_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics v = row_count;
  if v <> 1 then raise exception 'owner A tidak bisa update settings (row_count %)', v; end if;

  insert into public.menus (id, outlet_id, category_id, name, price, emoji, active)
  values ('rls-owner-menu', '11111111-1111-4111-8111-111111111111', 'paket', 'Menu uji RLS', 1234, '', true);
  select count(*) into v from public.menus;
  if v <> 12 then raise exception 'owner A gagal insert menu (count %)', v; end if;
end $test$;
reset role;

-- ---------------------------------------------------------------------------
-- Kasir: baca operasional, tidak boleh katalog/owner-only
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
set role authenticated;
do $test$
declare v bigint;
begin
  select count(*) into v from public.categories; if v <> 5 then raise exception 'kasir categories % != 5', v; end if;
  select count(*) into v from public.menus; if v <> 12 then raise exception 'kasir menus % != 12', v; end if;
  select count(*) into v from public.transactions; if v <> 4 then raise exception 'kasir transactions % != 4', v; end if;
  select count(*) into v from public.transaction_items; if v <> 5 then raise exception 'kasir transaction_items % != 5', v; end if;
  select count(*) into v from public.cash_movements; if v <> 3 then raise exception 'kasir cash % != 3', v; end if;
  select count(*) into v from public.preorders; if v <> 1 then raise exception 'kasir preorders % != 1', v; end if;
  select count(*) into v from public.preorder_items; if v <> 1 then raise exception 'kasir preorder_items % != 1', v; end if;
  select count(*) into v from public.accounts; if v <> 13 then raise exception 'kasir accounts % != 13', v; end if;
  select count(*) into v from public.outlet_members; if v <> 1 then raise exception 'kasir members % != 1', v; end if;
  select count(*) into v from public.stock_movements; if v <> 0 then raise exception 'kasir melihat stok %', v; end if;
  select count(*) into v from public.expenses; if v <> 0 then raise exception 'kasir melihat beban %', v; end if;
  select count(*) into v from public.journal_entries; if v <> 0 then raise exception 'kasir melihat jurnal %', v; end if;
  select count(*) into v from public.journal_lines; if v <> 0 then raise exception 'kasir melihat baris jurnal %', v; end if;
  select count(*) into v from public.audit_log; if v <> 0 then raise exception 'kasir melihat audit %', v; end if;

  update public.menus set price = 1 where id = 'dada';
  get diagnostics v = row_count;
  if v <> 0 then raise exception 'kasir bisa update menu (row_count %)', v; end if;
end $test$;

do $test$
begin
  begin
    insert into public.menus (id, outlet_id, category_id, name, price, emoji, active)
    values ('rls-cashier-menu', '11111111-1111-4111-8111-111111111111', 'paket', 'Kasir', 1, '', true);
    raise exception 'RLS GAGAL: kasir dapat insert menu';
  exception when insufficient_privilege then null;
  end;
end $test$;

do $test$
begin
  begin
    insert into public.outlet_members (outlet_id, user_id, role)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'owner');
    raise exception 'RLS GAGAL: kasir dapat menaikkan role';
  exception when insufficient_privilege then null;
  end;
end $test$;

do $test$
begin
  begin
    perform count(*) from public.outlet_counters;
    raise exception 'RLS GAGAL: kasir dapat membaca outlet_counters';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;

-- ---------------------------------------------------------------------------
-- Owner outlet B tidak boleh melihat/mengubah data outlet A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', false);
set role authenticated;
do $test$
declare v bigint;
begin
  select count(*) into v from public.outlets; if v <> 1 then raise exception 'owner B outlets % != 1', v; end if;
  select count(*) into v from public.categories; if v <> 1 then raise exception 'owner B categories % != 1', v; end if;
  select count(*) into v from public.menus; if v <> 0 then raise exception 'owner B melihat menu A %', v; end if;
  select count(*) into v from public.transactions; if v <> 0 then raise exception 'owner B melihat transaksi A %', v; end if;
  select count(*) into v from public.journal_entries; if v <> 0 then raise exception 'owner B melihat jurnal A %', v; end if;
  select count(*) into v from public.outlet_settings; if v <> 1 then raise exception 'owner B settings % != 1', v; end if;

  update public.outlets set name = 'Diretas' where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics v = row_count;
  if v <> 0 then raise exception 'owner B bisa update outlet A (row_count %)', v; end if;
end $test$;

do $test$
begin
  begin
    insert into public.categories (id, outlet_id, name, sort_order)
    values ('rls-b-cat', '11111111-1111-4111-8111-111111111111', 'Retas', 9);
    raise exception 'RLS GAGAL: owner B dapat menulis katalog outlet A';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;

-- ---------------------------------------------------------------------------
-- Anon tidak punya akses tabel
-- ---------------------------------------------------------------------------
set role anon;
do $test$
begin
  begin
    perform count(*) from public.categories;
    raise exception 'RLS GAGAL: anon dapat membaca categories';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;

-- ---------------------------------------------------------------------------
-- Integritas akhir: harga menu tidak berubah oleh percobaan kasir
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);
set role authenticated;
do $test$
declare v numeric;
begin
  select price into v from public.menus where id = 'dada';
  if v <> 16000 then raise exception 'harga dada berubah menjadi %', v; end if;
end $test$;
reset role;
