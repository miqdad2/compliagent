insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Demo Organization')
on conflict (id) do nothing;
