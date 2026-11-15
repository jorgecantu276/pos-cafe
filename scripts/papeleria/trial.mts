import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCartStore } from '../../store/useCartStore';
import { PapeleriaTrialStore } from './trial-store';

const directory = mkdtempSync(path.join(tmpdir(), 'pos-papeleria-trial-'));
try {
  const db = path.join(directory, 'synthetic.db');
  PapeleriaTrialStore.initialize(db);
  const store = new PapeleriaTrialStore(db, true);
  const cart = createCartStore();
  try {
    const pen = store.scan('0012345678905');
    const uncounted = store.scan('PENDIENTE');
    assert.ok(pen && uncounted);
    assert.equal(store.scan('12345678905'), null);
    assert.equal(store.scan('bol-azul')?.id, pen.id);

    cart.getState().addItem(pen);
    cart.getState().addItem(pen);
    assert.equal(cart.getState().getTotal(), 16.5);
    const items = cart.getState().items;
    assert.throws(() => store.checkout(randomUUID(), [...items, { id: 'unknown', product: uncounted, quantity: 1 }], 'efectivo', 5000), /conteo/);
    assert.throws(() => store.checkout(randomUUID(), [{ ...items[0], quantity: 5 }], 'efectivo', 5000), /existencias/);
    assert.throws(() => store.checkout(randomUUID(), [{ ...items[0], product: { ...pen, price: 1 } }], 'efectivo', 5000), /precio cambió/);
    assert.throws(() => store.checkout(randomUUID(), items, 'tarjeta', 2000), /no coincide/);
    assert.equal(store.scan('BOL-AZUL')?.inventory?.quantity, 4);

    const requestId = randomUUID();
    const sold = store.checkout(requestId, items, 'efectivo', 2000);
    assert.equal(sold.folio, 1);
    assert.equal(sold.totalCents, 1650);
    assert.equal(sold.changeCents, 350);
    assert.ok(sold.receipt.sections[0].includes('POS PAPELERÍA'));
    assert.ok(sold.receipt.sections[0].includes('Bolígrafo azul'));
    assert.ok(sold.receipt.sections[0].includes('TOTAL: $16.50 MXN'));
    assert.ok(sold.receipt.sections[0].includes('Cambio: $3.50'));
    assert.equal(sold.receipt.receiptBranding, undefined);
    assert.equal(sold.receipt.testOnly, true);
    assert.deepEqual(store.checkout(requestId, items, 'efectivo', 2000), sold);
    assert.equal(store.scan('BOL-AZUL')?.inventory?.quantity, 2);

    store.voidSale(sold.folio, 'Captura de prueba');
    assert.throws(() => store.voidSale(sold.folio, 'Segundo intento'), /ya está cancelada/);
    assert.equal(store.scan('BOL-AZUL')?.inventory?.quantity, 4);
    assert.deepEqual(store.readSale(sold.folio), sold);

    const active = store.checkout(randomUUID(), items, 'tarjeta', 1650);
    const backup = path.join(directory, 'backup.db');
    store.createBackup(backup);
    assert.throws(() => store.createBackup(backup), /EEXIST/);

    const recovery = path.join(directory, 'restore');
    mkdirSync(recovery);
    const restoredFile = path.join(recovery, 'restored.db');
    copyFileSync(backup, restoredFile);
    const restored = new PapeleriaTrialStore(restoredFile, false);
    try {
      assert.equal(restored.scan('BOL-AZUL')?.inventory?.quantity, 2);
      assert.deepEqual(restored.readSale(sold.folio), sold);
      assert.deepEqual(restored.readSale(active.folio), active);
    } finally { restored.close(); }
  } finally { store.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log('PASS Papelería: scanner input, paid sale, duplicate prevention, receipt preview, void, verified backup and restore.');
