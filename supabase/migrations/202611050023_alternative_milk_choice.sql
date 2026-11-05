-- Keep alternative milk single-choice in the same quote paths as standard milk.
begin;
do $migration$
declare
  signature text;
  definition text;
  old_check constant text := 'extra.phase in (''Tamaño'',''Tipo de Leche'')';
  new_check constant text := 'extra.phase in (''Tamaño'',''Tipo de Leche'',''Leche alternativa'')';
begin
  foreach signature in array array[
    'cafe_private.manual_checkout(uuid,jsonb)',
    'cafe_private.clip_quote(uuid,jsonb)',
    'cafe_private.phone_catalog_quote(uuid,jsonb)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    if position(old_check in definition) = 0
      or length(definition) - length(replace(definition, old_check, '')) <> length(old_check) then
      raise exception 'Unexpected milk validation in %; review before updating', signature;
    end if;
    execute replace(definition, old_check, new_check);
  end loop;
end $migration$;
commit;
