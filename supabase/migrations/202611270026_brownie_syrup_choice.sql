-- Rule only: catalog assignment is a separate, guarded maintenance operation.
begin;
set local lock_timeout = '5s';
do $migration$
declare
  signature text;
  definition text;
  anchor constant text := '    note:=coalesce(line->>''note'','''');';
  rule constant text := $rule$    -- brownie-syrup-v1: exactly one included syrup on assigned products.
    if 'Jarabe Brownie'=any(product.wizard_steps) and
      (select count(*) from unnest(phases) phase where phase='Jarabe Brownie') <> 1 then
      raise exception 'Selecciona un jarabe o Sin jarabe para el brownie';
    end if;
$rule$;
begin
  foreach signature in array array[
    'cafe_private.manual_checkout(uuid,jsonb)',
    'cafe_private.clip_quote(uuid,jsonb)',
    'cafe_private.phone_catalog_quote(uuid,jsonb)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    if position(rule in definition) > 0 then continue; end if;
    if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
      raise exception 'Revisa la validación de jarabe en % antes de actualizar', signature;
    end if;
    execute replace(definition,anchor,rule||anchor);
  end loop;
end $migration$;
commit;
