-- Fixture uji RLS (dijalankan sebagai postgres/service role setelah seed).
insert into public.outlet_members (outlet_id, user_id, role)
values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'cashier')
on conflict (outlet_id, user_id) do nothing;

insert into public.outlets (id, name) values
  ('44444444-4444-4444-8444-444444444444', 'Outlet B')
on conflict (id) do nothing;

insert into public.outlet_settings (outlet_id, outlet_name) values
  ('44444444-4444-4444-8444-444444444444', 'Outlet B')
on conflict (outlet_id) do nothing;

insert into public.outlet_members (outlet_id, user_id, role) values
  ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', 'owner')
on conflict (outlet_id, user_id) do nothing;

insert into public.categories (id, outlet_id, name, sort_order) values
  ('b-paket', '44444444-4444-4444-8444-444444444444', 'Paket', 0)
on conflict (id) do nothing;
