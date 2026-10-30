-- Candidate only. Apply after 001 and 002 with the matching application.
-- Existing balances and the dual product/recipe policy are preserved.
begin;
select pg_advisory_xact_lock(60281028);
select pg_advisory_xact_lock(60281029);
alter table public.products
  add column inventory_mode text not null default 'both' check(inventory_mode in ('product','recipe','both','untracked')),
  add column stock_product_id uuid references public.products(id),
  add column stock_units integer not null default 1 check(stock_units between 1 and 1000),
  add column inventory_revision bigint not null default 0,
  add constraint product_stock_source check(stock_product_id is null or stock_product_id<>id);
alter table public.supplies add column inventory_revision bigint not null default 0,
  add column is_active boolean not null default true;

create table cafe_private.inventory_requests (
  actor_id uuid not null references public.profiles(id), request_id uuid not null,
  operation text not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles(id),
  request_id uuid not null, target_kind text not null check(target_kind in ('product','supply')),
  target_id uuid not null, target_name text not null, unit text not null,
  operation text not null check(operation in ('entrada','merma','conteo','venta')),
  quantity_before numeric not null, quantity_after numeric not null, delta numeric not null,
  revision bigint not null, reason text not null, order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  check(quantity_after>=0 and quantity_after::text not in ('NaN','Infinity','-Infinity')),
  check(quantity_after-quantity_before=delta)
);
create index inventory_movements_target on public.inventory_movements(target_kind,target_id,created_at desc,id);
create index inventory_movements_request on public.inventory_movements(actor_id,request_id);
create table public.product_inventory_recipes (
  product_id uuid not null references public.products(id),
  extra_ids uuid[] not null default '{}', ingredients jsonb not null,
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  primary key(product_id,extra_ids)
);
-- Preserve and aggregate the original recipes as the no-modifier variants.
insert into public.product_inventory_recipes(product_id,ingredients)
select product_id,jsonb_agg(jsonb_build_object('supply_id',supply_id,'quantity',quantity) order by supply_id)
from (select product_id,supply_id,sum(quantity_required) quantity from public.product_recipes
  where product_id is not null group by product_id,supply_id) r group by product_id;
alter table public.inventory_movements enable row level security;
alter table public.product_inventory_recipes enable row level security;
revoke all on cafe_private.inventory_requests,public.inventory_movements,public.product_inventory_recipes from public,anon,authenticated;
grant select on public.inventory_movements,public.product_inventory_recipes to authenticated;
create policy inventory_history_admin on public.inventory_movements for select to authenticated using(cafe_private.is_admin());
create policy inventory_recipe_admin on public.product_inventory_recipes for select to authenticated using(cafe_private.is_admin());

-- Metadata editors cannot replace a balance loaded before a sale. New rows
-- start at zero; every subsequent balance change uses an audited operation.
revoke insert,update,delete on public.products,public.supplies,public.product_recipes from authenticated;
grant insert(name,price,category,category_id,description,image_url,is_active,customizable,wizard_steps),
  update(name,price,category,category_id,description,image_url,is_active,customizable,wizard_steps) on public.products to authenticated;
grant insert(name,unit,min_stock,cost_per_unit,is_active),
  update(name,min_stock,cost_per_unit,is_active) on public.supplies to authenticated;

create function cafe_private.inventory_replay(p_request uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior cafe_private.inventory_requests; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Solicitud de inventario inválida'; end if;
  if p_payload->>'actor_id' is distinct from auth.uid()::text then raise exception 'La sesión cambió. Recupera la solicitud con su administrador original' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(60281029);
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into prior from cafe_private.inventory_requests where actor_id=auth.uid() and request_id=p_request;
  if found then
    if prior.operation<>p_operation or prior.payload is distinct from p_payload then raise exception 'Identidad de inventario reutilizada con otros datos'; end if;
    return prior.result;
  end if;
  return null;
end $$;

create function public.pos_adjust_inventory(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; kind text:=p_payload->>'kind'; target uuid:=(p_payload->>'id')::uuid;
  operation text:=p_payload->>'operation'; amount numeric:=(p_payload->>'quantity')::numeric;
  revision bigint:=(p_payload->>'revision')::bigint; reason text:=trim(p_payload->>'reason');
  before_qty numeric; after_qty numeric; current_revision bigint; target_name text; unit_name text; mode text;
begin
  result:=cafe_private.inventory_replay(p_request,'movement',p_payload); if result is not null then return result; end if;
  if kind is null or kind not in ('product','supply') or target is null or operation is null or operation not in ('entrada','merma','conteo')
    or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>99999999.99 or amount<>round(amount,2)
    or (operation<>'conteo' and amount=0) or reason is null or length(reason) not between 3 and 300 then raise exception 'Revisa cantidad, operación y motivo'; end if;
  if kind='product' then
    select stock,inventory_revision,name,'pza',inventory_mode into before_qty,current_revision,target_name,unit_name,mode
      from public.products where id=target and stock_product_id is null for update;
    if not found then raise exception 'Registra el movimiento en el producto que comparte las existencias'; end if;
    if mode not in ('product','both') or amount<>trunc(amount) then raise exception 'Este producto no lleva conteo de piezas o la cantidad no es entera'; end if;
  else
    select current_stock,inventory_revision,name,unit into before_qty,current_revision,target_name,unit_name
      from public.supplies where id=target and is_active for update;
    if not found then raise exception 'Insumo no disponible'; end if;
    if p_payload->>'unit' is distinct from unit_name then raise exception 'La unidad cambió. Recarga el insumo'; end if;
    if unit_name='pza' and amount<>trunc(amount) then raise exception 'Las piezas deben ser enteras'; end if;
  end if;
  if before_qty is null or before_qty<0 or before_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Saldo inválido: requiere conciliación previa'; end if;
  -- Additive receipts/waste serialize with sales. Counts are absolute and must
  -- reject a stale screen even when the numerical balance happens to match.
  if operation='conteo' and (revision is null or revision<>current_revision) then raise exception 'El inventario cambió. Recarga y vuelve a contar'; end if;
  after_qty:=case operation when 'entrada' then before_qty+amount when 'merma' then before_qty-amount else amount end;
  if after_qty<0 or after_qty>99999999.99 then raise exception 'Existencias insuficientes o fuera de rango'; end if;
  if kind='product' then update public.products set stock=after_qty,inventory_revision=inventory_revision+1 where id=target;
  else update public.supplies set current_stock=after_qty,inventory_revision=inventory_revision+1 where id=target; end if;
  insert into public.inventory_movements(actor_id,request_id,target_kind,target_id,target_name,unit,operation,quantity_before,quantity_after,delta,revision,reason)
    values(auth.uid(),p_request,kind,target,target_name,unit_name,operation,before_qty,after_qty,after_qty-before_qty,current_revision+1,reason);
  result:=jsonb_build_object('request_id',p_request,'actor_id',auth.uid(),'operation','movement','id',target,'kind',kind,'quantity',after_qty,'revision',current_revision+1);
  insert into cafe_private.inventory_requests values(auth.uid(),p_request,'movement',p_payload,result,now());
  return result;
end $$;

create function public.pos_configure_inventory(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; target uuid:=(p_payload->>'id')::uuid; mode text:=p_payload->>'mode';
  source_id uuid:=nullif(p_payload->>'source_id','')::uuid; units integer:=(p_payload->>'units')::integer;
  revision bigint:=(p_payload->>'revision')::bigint; reason text:=trim(p_payload->>'reason'); product public.products;
begin
  result:=cafe_private.inventory_replay(p_request,'policy',p_payload); if result is not null then return result; end if;
  select * into product from public.products where id=target for update;
  if not found or mode is null or mode not in ('product','recipe','both','untracked') or units is null or units not between 1 and 1000
    or reason is null or length(reason) not between 3 and 300 then raise exception 'Configuración de inventario inválida'; end if;
  if revision is null or revision<>product.inventory_revision then raise exception 'El inventario cambió. Recarga antes de configurar'; end if;
  if source_id is null and units<>1 then raise exception 'Selecciona las piezas compartidas para un paquete'; end if;
  if source_id is not null and (source_id=target or mode not in ('product','both') or not exists(
    select 1 from public.products where id=source_id and stock_product_id is null and stock_units=1 and inventory_mode in ('product','both')
  )) then raise exception 'Origen de piezas inválido; no se permiten cadenas de paquetes'; end if;
  if exists(select 1 from public.products where stock_product_id=target) and (source_id is not null or units<>1 or mode not in ('product','both')) then raise exception 'Otros paquetes comparten estas piezas; conserva su conteo'; end if;
  if source_id is not null and product.stock<>0 then raise exception 'Concilia a cero las existencias propias antes de compartir piezas'; end if;
  update public.products set inventory_mode=mode,stock_product_id=source_id,stock_units=units,inventory_revision=inventory_revision+1 where id=target;
  result:=jsonb_build_object('request_id',p_request,'actor_id',auth.uid(),'operation','policy','id',target,'revision',revision+1,'mode',mode,'source_id',source_id,'units',units);
  -- Request journal records old/new policy and the owner's operational reason.
  result:=result||jsonb_build_object('previous_mode',product.inventory_mode,'previous_source_id',product.stock_product_id,'previous_units',product.stock_units,'reason',reason);
  insert into cafe_private.inventory_requests values(auth.uid(),p_request,'policy',p_payload,result,now());
  return result;
end $$;

create function public.pos_save_inventory_recipe(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; target uuid:=(p_payload->>'id')::uuid; revision bigint:=(p_payload->>'revision')::bigint;
  product public.products; ids uuid[]; ingredient jsonb; ingredients jsonb:=p_payload->'ingredients';
  amount numeric; reason text:=trim(p_payload->>'reason'); previous jsonb;
begin
  result:=cafe_private.inventory_replay(p_request,'recipe',p_payload); if result is not null then return result; end if;
  select * into product from public.products where id=target for update;
  if not found or revision is null or revision<>product.inventory_revision then raise exception 'El producto cambió. Recarga antes de guardar la receta'; end if;
  if reason is null or length(reason) not between 3 and 300 or jsonb_typeof(p_payload->'extra_ids') is distinct from 'array'
    or jsonb_array_length(p_payload->'extra_ids')>30 or jsonb_typeof(ingredients) is distinct from 'array'
    or jsonb_array_length(ingredients) not between 1 and 50 then raise exception 'Receta inválida: confirma opciones, cantidades y motivo'; end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}') into ids from jsonb_array_elements_text(p_payload->'extra_ids');
  if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) or exists(
    select 1 from unnest(ids) v left join public.extras e on e.id=v where e.id is null or e.active is not true
      or product.customizable is not true or not coalesce(e.phase=any(product.wizard_steps),false)
  ) or exists(select 1 from public.extras where id=any(ids) and phase in ('Tipo de Leche','Tamaño','Leche alternativa') group by phase having count(*)>1)
    then raise exception 'Opciones de receta no permitidas'; end if;
  if (select count(*)<>count(distinct value->>'supply_id') from jsonb_array_elements(ingredients)) then raise exception 'Insumo duplicado'; end if;
  for ingredient in select value from jsonb_array_elements(ingredients) loop
    amount:=(ingredient->>'quantity')::numeric;
    if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>99999999.99 or amount<>round(amount,2)
      or not exists(select 1 from public.supplies where id=(ingredient->>'supply_id')::uuid and is_active
        and (unit<>'pza' or amount=trunc(amount))) then raise exception 'Insumo o cantidad de receta inválidos'; end if;
  end loop;
  select r.ingredients into previous from public.product_inventory_recipes r where product_id=target and extra_ids=ids;
  insert into public.product_inventory_recipes(product_id,extra_ids,ingredients,updated_by) values(target,ids,ingredients,auth.uid())
    on conflict(product_id,extra_ids) do update set ingredients=excluded.ingredients,updated_by=excluded.updated_by,updated_at=now();
  if cardinality(ids)=0 then
    delete from public.product_recipes where product_id=target;
    insert into public.product_recipes(product_id,supply_id,quantity_required)
      select target,(value->>'supply_id')::uuid,(value->>'quantity')::numeric from jsonb_array_elements(ingredients);
  end if;
  update public.products set inventory_revision=inventory_revision+1 where id=target;
  result:=jsonb_build_object('request_id',p_request,'actor_id',auth.uid(),'operation','recipe','id',target,'revision',revision+1,'previous_ingredients',previous,'extra_ids',ids,'ingredients',ingredients,'reason',reason);
  insert into cafe_private.inventory_requests values(auth.uid(),p_request,'recipe',p_payload,result,now());
  return result;
end $$;

-- Called only inside pos_checkout after the common inventory lock. Quantities
-- are aggregated across duplicate lines AND packs before balances are changed.
create function cafe_private.consume_inventory(p_request uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare line jsonb; product public.products; ids uuid[]; recipe jsonb; ingredient jsonb;
  demands jsonb:='[]'; stocks jsonb:='[]'; need record; before_qty numeric; rev bigint; name text; unit_name text; amount numeric;
begin
  for line in select value from jsonb_array_elements(p_items) loop
    select * into strict product from public.products where id=(line->>'product_id')::uuid;
    if product.inventory_mode in ('product','both') then
      demands:=demands||jsonb_build_array(jsonb_build_object('kind','product','id',coalesce(product.stock_product_id,product.id),'quantity',(line->>'quantity')::integer*product.stock_units));
    end if;
    if product.inventory_mode in ('recipe','both') then
      select coalesce(array_agg(value::uuid order by value::uuid),'{}') into ids from jsonb_array_elements_text(line->'extra_ids');
      select ingredients into recipe from public.product_inventory_recipes where product_id=product.id and extra_ids=ids;
      if not found then
        if product.inventory_mode='recipe' or exists(select 1 from public.product_inventory_recipes where product_id=product.id)
          then raise exception 'No hay receta confirmada para estas opciones de %',product.name; end if;
      else
        for ingredient in select value from jsonb_array_elements(recipe) loop
          amount:=(ingredient->>'quantity')::numeric;
          if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or amount<>round(amount,2) then raise exception 'Receta inválida'; end if;
          demands:=demands||jsonb_build_array(jsonb_build_object('kind','supply','id',ingredient->>'supply_id','quantity',amount*(line->>'quantity')::integer));
        end loop;
      end if;
    end if;
  end loop;
  for need in select value->>'kind' kind,(value->>'id')::uuid id,sum((value->>'quantity')::numeric) qty
    from jsonb_array_elements(demands) group by value->>'kind',(value->>'id')::uuid order by value->>'kind',(value->>'id')::uuid loop
    if need.kind='product' then
      select stock,inventory_revision,p.name,'pza' into before_qty,rev,name,unit_name from public.products p
        where id=need.id and stock_product_id is null and inventory_mode in ('product','both') for update;
      if not found then raise exception 'Origen de piezas no disponible'; end if;
    else
      select current_stock,inventory_revision,s.name,unit into before_qty,rev,name,unit_name from public.supplies s where id=need.id and is_active for update;
      if not found then raise exception 'Insumo no disponible'; end if;
    end if;
    if before_qty is null or before_qty::text in ('NaN','Infinity','-Infinity') or before_qty<need.qty then raise exception 'Stock insuficiente de %',name; end if;
    if need.kind='product' then update public.products set stock=stock-need.qty,inventory_revision=inventory_revision+1 where id=need.id;
    else update public.supplies set current_stock=current_stock-need.qty,inventory_revision=inventory_revision+1 where id=need.id; end if;
    stocks:=stocks||jsonb_build_array(jsonb_build_object('kind',need.kind,'id',need.id,'quantity',need.qty,'before',before_qty,'after',before_qty-need.qty,'revision',rev+1));
    insert into public.inventory_movements(actor_id,request_id,target_kind,target_id,target_name,unit,operation,quantity_before,quantity_after,delta,revision,reason)
      values(auth.uid(),p_request,need.kind,need.id,name,unit_name,'venta',before_qty,before_qty-need.qty,-need.qty,rev+1,'Venta confirmada');
  end loop;
  return stocks;
end $$;
revoke all on function cafe_private.inventory_replay(uuid,text,jsonb),cafe_private.consume_inventory(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.pos_adjust_inventory(uuid,jsonb),public.pos_configure_inventory(uuid,jsonb),public.pos_save_inventory_recipe(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pos_adjust_inventory(uuid,jsonb),public.pos_configure_inventory(uuid,jsonb),public.pos_save_inventory_recipe(uuid,jsonb) to authenticated;

-- The replacement pos_checkout below preserves the financial/replay contract.
create or replace function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.cash_registers; o public.orders; product public.products; extra public.extras; customer public.customers;
  line jsonb; xid text; qty integer; unit numeric; total numeric:=0; preview numeric;
  mxn numeric; usd numeric; received numeric; method text; cid uuid; earned integer:=0;
  lines jsonb:='[]'; stocks jsonb:='[]'; extra_list jsonb; line_product jsonb;
  need record; note text; phases text[]; customer_name text:='Invitado';
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  select * into o from public.orders where cashier_id=auth.uid() and request_id=p_request;
  if found then
    if o.request_payload is distinct from p_payload then raise exception 'Identidad de venta reutilizada con otros datos'; end if;
    return o.receipt_snapshot || jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
  end if;
  if exists(select 1 from cafe_private.abandoned_checkouts where cashier_id=auth.uid() and request_id=p_request) then raise exception 'Solicitud descartada; no se registró una venta'; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register_id')::uuid and opened_by=auth.uid() for update;
  if not found or r.status<>'open' or r.exchange_rate is null then raise exception 'Abre o recupera tu turno antes de cobrar'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Orden vacía o demasiado grande'; end if;
  method:=p_payload->>'payment_method';
  if method is null or method not in ('efectivo','mixto','tarjeta','otro') then raise exception 'Método inválido'; end if;
  -- Stable locks also protect duplicate product lines within one sale.
  perform pg_advisory_xact_lock(60281029);
  perform 1 from public.products where id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_payload->'items') v) order by id for update;
  for line in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
      or (line->>'quantity')::numeric not between 1 and 1000 then raise exception 'Cantidad inválida'; end if;
    qty:=(line->>'quantity')::integer;
    select * into product from public.products where id=(line->>'product_id')::uuid;
    if not found or product.is_active is not true or product.price is null or product.price<0 or product.price::text='NaN' then raise exception 'Producto no disponible'; end if;
    if jsonb_typeof(line->'extra_ids') is distinct from 'array' or jsonb_array_length(line->'extra_ids')>30 then raise exception 'Extras inválidos'; end if;
    unit:=product.price; extra_list:='[]'; phases:='{}';
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(line->'extra_ids')) then raise exception 'Extra duplicado'; end if;
    for xid in select value from jsonb_array_elements_text(line->'extra_ids') loop
      select * into extra from public.extras where id=xid::uuid for share;
      if not found or extra.active is not true or product.customizable is not true or not coalesce(extra.phase=any(product.wizard_steps),false)
        or extra.price is null or extra.price<0 or extra.price::text='NaN' then raise exception 'Extra no permitido'; end if;
      if extra.phase in ('Tamaño','Tipo de Leche','Leche alternativa') and extra.phase=any(phases) then raise exception 'Selecciona una opción por fase'; end if;
      phases:=array_append(phases,extra.phase); unit:=unit+extra.price;
      extra_list:=extra_list||jsonb_build_array(jsonb_build_object('id',extra.id,'name',extra.name,'phase',extra.phase,'price',extra.price));
    end loop;
    note:=coalesce(line->>'note','');
    if length(note)>1000 then raise exception 'Nota demasiado larga'; end if;
    line_product:=jsonb_build_object('id',product.id,'name',product.name,'price',unit,'basePrice',product.price,'category',product.category,'displayExtras',extra_list,'note',note);
    lines:=lines||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'quantity',qty,'product',line_product));
    total:=total+unit*qty;
  end loop;
  preview:=(p_payload->>'expected_total')::numeric;
  if total<=0 or total>10000000 or preview is null or total<>preview then raise exception 'El catálogo cambió. Revisa la orden antes de cobrar'; end if;
  if length(coalesce(p_payload->>'order_note',''))>1000 or (p_payload->>'order_type') is null or (p_payload->>'order_type') not in ('En Local','Para Llevar') then raise exception 'Datos de preparación inválidos'; end if;
  mxn:=(p_payload->>'tender_mxn')::numeric; usd:=(p_payload->>'tender_usd')::numeric;
  if mxn is null or usd is null or mxn::text in ('NaN','Infinity','-Infinity') or usd::text in ('NaN','Infinity','-Infinity') or mxn<0 or usd<0 or mxn>10000000 or usd>1000000 or mxn<>round(mxn,2) or usd<>round(usd,2) then raise exception 'Importe recibido inválido'; end if;
  received:=round(mxn+usd*r.exchange_rate,2);
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  stocks:=cafe_private.consume_inventory(p_request,p_payload->'items');
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
    update public.customers set points=coalesce(customers.points,0)+earned,total_spent=coalesce(total_spent,0)+total,last_visit=now() where id=cid;
  end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,stock_snapshot,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn)
    values(r.id,cid,auth.uid(),total,0,total,method,'completed',p_request,p_payload,stocks,earned,mxn,usd,r.exchange_rate,case when method in ('efectivo','mixto') then received-total else 0 end) returning * into o;
  update public.inventory_movements set order_id=o.id where actor_id=auth.uid() and request_id=p_request and operation='venta' and order_id is null;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::integer,(line->'product'->>'price')::numeric,
      (line->>'quantity')::integer*(line->'product'->>'price')::numeric,
      concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  update public.orders set receipt_snapshot=jsonb_build_object('items',lines,'total',o.total,'customer_name',customer_name,'order_type',p_payload->>'order_type','order_note',p_payload->>'order_note','created_at',o.created_at,'payment_method',method,'tender_mxn',mxn,'tender_usd',usd,'exchange_rate',r.exchange_rate,'change_mxn',o.change_mxn) where id=o.id returning * into o;
  return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
end $$;


commit;
