create or replace function public.create_tenant_with_owner(tenant_name text, tenant_slug text, restaurant_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_tenant uuid; new_restaurant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into tenants(name, slug) values (tenant_name, tenant_slug) returning id into new_tenant;
  insert into tenant_members(tenant_id, user_id, role) values (new_tenant, auth.uid(), 'owner');
  insert into restaurants(tenant_id, name) values (new_tenant, restaurant_name) returning id into new_restaurant;
  for i in 1..4 loop
    insert into cameras(tenant_id, restaurant_id, name, position, storage_prefix)
    values (new_tenant, new_restaurant, 'Câmera ' || i, i, 'raw/' || new_tenant || '/' || new_restaurant || '/camera-' || i);
  end loop;
  return new_tenant;
end $$;
grant execute on function public.create_tenant_with_owner(text,text,text) to authenticated;
