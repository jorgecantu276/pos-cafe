import { createHash } from 'node:crypto';

// Original synthetic catalog. Never import the customer's real-menu fixture.
export const baseline = '1204ca8b7470763da23ffd5881d545d10df2f8f4';
export const fixtureVersion = 'generic-coffee-v1';
export function id(key) {
  const h = createHash('sha256').update(`${fixtureVersion}:${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
const products = [];
function product(key, name, price, category = 'Bebidas', steps = [], inventory = {}) {
  products.push({ key, id: id(key), name, price, category, customizable: steps.length > 0,
    wizard_steps: steps, is_active: true, image_url: null, inventory: { mode: 'availability', available: true, ...inventory } });
}
const coffee = ['Tipo de Leche', 'Endulzante', 'Sabor'];
for (const [flavor, offset] of [['miel de maple',0], ['cacao tostado',7.5], ['cardamomo',11]]) {
  for (const size of [16,20]) product(`iced-${flavor}-${size}`, `Iced coffee ${flavor} ${size} oz`, 62.5 + offset + (size === 20 ? 19 : 0), 'Bebidas', coffee);
}
// An intentionally unmatched size: the existing selector must request a new preparation.
product('iced-seasonal', 'Iced coffee naranja especiada 16 oz', 78.5, 'Bebidas', coffee, { available: false });
for (const size of [16,20]) product(`matcha-${size}`, `Matcha vainilla de jardín ${size} oz`, size === 16 ? 74 : 96, 'Bebidas', ['Leche alternativa','Endulzante','Espuma']);
product('matcha-special', 'Matcha pera especiada 20 oz', 102.5, 'Bebidas', ['Leche alternativa','Espuma']);
product('nevado-a', 'Nevado café de olla', 83, 'Bebidas', ['Creamer','Endulzante']);
product('nevado-b', 'Nevado cacao blanco', 89.5, 'Bebidas', ['Creamer','Sabor']);
product('frappe-a', 'Frappe avellana tostada', 86, 'Bebidas', ['Tipo de Leche','Sabor']);
product('frappe-b', 'Frappuccino canela suave', 86, 'Bebidas', ['Tipo de Leche','Sabor']);
// These exact temperature tokens are the baseline's chai-family recognizer.
product('chai-hot', 'Te chai caliente', 71.5, 'Bebidas', ['Tipo de Leche','Endulzante']);
product('chai-cold', 'Te chai frio', 76, 'Bebidas', ['Tipo de Leche','Endulzante']);
product('filter', 'Café filtrado del día', 38.5, 'Bebidas', ['Tamaño','Endulzante']);
product('espresso', 'Espresso doble de la casa', 34);
product('chocolate', 'Chocolate de mesa especiado', 65.5, 'Bebidas', ['Temperatura','Tipo de Leche']);
product('affogato', 'Café con helado de temporada', 69, 'Bebidas', ['Helado gourmet']);
product('tea', 'Infusión de jamaica y naranja', 42);
product('water', 'Agua mineral natural 355 ml', 28.5, 'Botellas', [], { mode: 'counted', quantity: 24, minimum: 6, unit: 'botella' });
product('juice', 'Jugo de manzana 250 ml', 32, 'Botellas', [], { mode: 'counted', quantity: 0, minimum: 4, unit: 'botella' });
product('cookie', 'Galleta de avena y arándano', 27.5, 'Postres', ['Acabado'], { mode: 'counted', quantity: 18, minimum: 5 });
product('muffin', 'Muffin de limón y amapola', 41, 'Postres', [], { mode: 'counted', quantity: 2, minimum: 4 });
product('cake', 'Rebanada de pastel de zanahoria', 58.5, 'Postres', [], { mode: 'counted', quantity: null, minimum: 3, unit: 'rebanada' });
product('tart', 'Tarta de manzana y canela', 63, 'Postres', ['Acabado']);
product('sandwich', 'Sándwich de queso y tomate', 72, 'Cocina', ['Preparación']);
product('toast', 'Tostada de aguacate y semillas', 68.5, 'Cocina', ['Preparación']);
product('beans', 'Café en grano 250 g', 184.5, 'Despensa', [], { mode: 'counted', quantity: 9, minimum: 3, unit: 'paquete' });
product('cup', 'Vaso reutilizable', 115, 'Despensa', [], { mode: 'counted', quantity: 1, minimum: 2 });
product('whole-cake', 'Pastel completo de naranja', 325.5, 'Postres', [], { mode:'counted',quantity:3,minimum:1,unit:'pastel' });
product('canned-tea', 'Té negro con limón en lata', 31, 'Botellas', [], { mode:'counted',quantity:12,minimum:4,unit:'lata' });
product('retired', 'Limonada de romero de temporada', 47.5);
products.at(-1).is_active = false;
products.find(p=>p.key==='filter').image_url='/product-photos/black-coffee.webp';
products.find(p=>p.key==='cookie').image_url='/product-photos/cookie.webp';

const extras = [];
function extra(key, name, price, phase, active = true) { extras.push({ key, id: id(key), name, price, phase, active, orden_opcion: extras.filter(e => e.phase === phase).length }); }
for (const [phase, prefix, oat] of [['Tipo de Leche','milk',8.5],['Leche alternativa','alt',0]]) {
  extra(`${prefix}-whole`, 'Leche entera', 0, phase);
  extra(`${prefix}-oat`, 'Bebida de avena', oat, phase);
  extra(`${prefix}-almond`, 'Bebida de almendra', phase === 'Tipo de Leche' ? 9 : 6.5, phase);
}
for (const [key,name,price,phase] of [
  ['size-regular','Regular',0,'Tamaño'],['size-large','Grande',12.5,'Tamaño'],
  ['sugar-none','Sin azúcar',0,'Endulzante'],['sugar-cane','Azúcar de caña',0,'Endulzante'],['sugar-honey','Miel de agave',4.5,'Endulzante'],
  ['syrup-vanilla','Vainilla natural',5.5,'Sabor'],['syrup-cinnamon','Canela molida',0,'Sabor'],['syrup-cocoa','Cacao extra',7,'Sabor'],
  ['foam-simple','Espuma suave',0,'Espuma'],['foam-citrus','Espuma cítrica',8,'Espuma'],
  ['cream-plain','Crema natural',0,'Creamer'],['cream-coconut','Crema de coco',6,'Creamer'],
  ['ice-vanilla','Helado de vainilla',0,'Helado gourmet'],['ice-coffee','Helado de café',5.5,'Helado gourmet'],
  ['temp-hot','Caliente',0,'Temperatura'],['temp-cold','Frío',0,'Temperatura'],
  ['finish-warm','Tibio',0,'Acabado'],['finish-cocoa','Cacao espolvoreado',3.5,'Acabado'],
  ['prep-toast','Pan tostado',0,'Preparación'],['prep-no-salt','Sin sal añadida',0,'Preparación'],
]) extra(key,name,price,phase);
extra('retired-extra','Jarabe de temporada retirado',6,'Sabor',false);

export const menu = { version: fixtureVersion, currency: 'MXN', products, extras,
  favorites: ['iced-miel de maple-16','matcha-16','chai-hot','filter','cookie','water','muffin','affogato'].map(id) };
