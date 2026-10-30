import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { customizeProduct, useCartStore, type Product } from '../store/useCartStore';

const coffee: Product = { id: 'coffee', name: 'Café', price: 50, category: 'Bebidas'};
beforeEach(() => useCartStore.getState().clearCart());

test('same modifiers with conflicting preparation notes remain separate', () => {
  const extras = [{ id: 'vanilla', name: 'Vainilla', price: 10 }];
  useCartStore.getState().addItem(customizeProduct(coffee, extras, 'Sin hielo'));
  useCartStore.getState().addItem(customizeProduct(coffee, extras, 'Hielo extra'));
  assert.equal(useCartStore.getState().items.length, 2);
  assert.deepEqual(useCartStore.getState().items.map(item => item.product.note), ['Sin hielo', 'Hielo extra']);
});

test('editing the same customized line repeatedly preserves price and quantity', () => {
  const extras = [{ id: 'vanilla', name: 'Vainilla', price: 10 }];
  const customized = customizeProduct(coffee, extras, 'Caliente');
  useCartStore.getState().addItem(customized);
  useCartStore.getState().addItem(customized);
  const id = useCartStore.getState().items[0].id;
  for (let edit = 0; edit < 3; edit++) {
    useCartStore.getState().replaceItem(id, customizeProduct(useCartStore.getState().items[0].product, extras, 'Caliente'));
  }
  assert.equal(useCartStore.getState().items[0].quantity, 2);
  assert.equal(useCartStore.getState().items[0].product.price, 60);
  assert.equal(useCartStore.getState().getTotal(), 120);
});

test('changing or removing an extra starts from the base price', () => {
  const original = customizeProduct(coffee, [{ name: 'Vainilla', price: 10 }], '');
  assert.equal(customizeProduct(original, [], '').price, 50);
  assert.equal(customizeProduct(original, [{ name: 'Leche', price: 15 }], '').price, 65);
});

test('older cart lines without basePrice recover it from their extras', () => {
  const oldLine = { ...coffee, price: 60, displayExtras: [{ name: 'Vainilla', price: 10 }] };
  assert.equal(customizeProduct(oldLine, oldLine.displayExtras, '').price, 60);
});

test('same named extras from different phases or prices do not merge', () => {
  useCartStore.getState().addItem(customizeProduct(coffee, [{ id: 'a', phase: 'Leche', name: 'Normal', price: 0 }], ''));
  useCartStore.getState().addItem(customizeProduct(coffee, [{ id: 'b', phase: 'Tamaño', name: 'Normal', price: 0 }], ''));
  assert.equal(useCartStore.getState().items.length, 2);
});

test('cart totals use cents and invalid quantity updates do not corrupt the cart', () => {
  useCartStore.getState().addItem({ ...coffee, price: 0.1 });
  useCartStore.getState().addItem({ ...coffee, id: 'other', price: 0.2 });
  assert.equal(useCartStore.getState().getTotal(), 0.3);
  const id = useCartStore.getState().items[0].id;
  useCartStore.getState().updateQuantity(id, NaN);
  assert.equal(useCartStore.getState().items[0].quantity, 1);
});
