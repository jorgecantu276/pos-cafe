import assert from 'node:assert/strict';

// Match the client bootstrap: only the milk choices explicitly confirmed by
// the owner. Dirty chai and other drinks are not silently opted into a charge.
/** @param {{products: Array<{name: string, price_mxn: number, category: string, milk_surcharge_scope: string}>, rules: {standard_iced_milks: string[], alternate_milks: string[], alternate_milk_surcharge_mxn: number}}} menu */
export function qualityMenuCatalog(menu) {
  const phase = 'Tipo de Leche';
  const products = menu.products.map(product => {
    const customizable = product.milk_surcharge_scope === 'confirmed_15_mxn';
    return { name: product.name, price: product.price_mxn, category: product.category,
      customizable, wizard_steps: customizable ? [phase] : [] };
  });
  const extras = [
    ...menu.rules.standard_iced_milks.map(name => ({ name, price: 0 })),
    ...menu.rules.alternate_milks.map(name => ({ name, price: menu.rules.alternate_milk_surcharge_mxn })),
  ].map((extra, index) => ({ ...extra, phase, active: true, orden_opcion: index }));
  assert.equal(new Set(products.map(product => product.name)).size, products.length);
  assert.equal(new Set(extras.map(extra => extra.name.toLowerCase())).size, extras.length);
  return { products, extras };
}

// For the disposable local quality backend only. Re-running repairs older
// previews that seeded every product without its wizard. Existing identities,
// prices, stock, orders, snapshots and journals are deliberately preserved.
export async function seedQualityMenu(db, menu) {
  const catalog = qualityMenuCatalog(menu);
  await db.query('begin');
  try {
    for (const product of catalog.products) {
      await db.query(`insert into products(name,price,category,stock,is_active,customizable,wizard_steps)
        select $1,$2,$3,null,true,$4,$5 where not exists(select 1 from products where name=$1)`,
      [product.name, product.price, product.category, product.customizable, product.wizard_steps]);
      await db.query('update products set customizable=$2,wizard_steps=$3 where name=$1',
        [product.name, product.customizable, product.wizard_steps]);
    }
    for (const extra of catalog.extras) {
      // The admin drill also has an Almendra option in phase "Leche" with a
      // different synthetic price. Never alter that unrelated phase.
      await db.query(`insert into extras(name,price,phase,active,orden_opcion)
        select $1,$2,$3,true,$4 where not exists(select 1 from extras where lower(name)=lower($1) and phase=$3)`,
      [extra.name, extra.price, extra.phase, extra.orden_opcion]);
      await db.query('update extras set price=$2,active=true,orden_opcion=$4 where lower(name)=lower($1) and phase=$3',
        [extra.name, extra.price, extra.phase, extra.orden_opcion]);
    }
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  return catalog;
}
