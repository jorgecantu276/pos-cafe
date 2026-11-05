import { productAvailable, type CatalogProduct } from './pos-types';

export type DrinkSize = '16 oz' | '20 oz';
export type MenuVariant = { product: CatalogProduct; label: string; size?: DrinkSize };
export type MenuCard = CatalogProduct & { variants?: MenuVariant[]; variantTitle?: string; fromPrice?: boolean };

export const normalizeMenuText = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const matchaLabels: Record<string, string> = {
  'matcha carino': 'Cariño',
  'matcha latte carino': 'Cariño',
  'matcha fresa': 'Fresa',
  'matcha mango': 'Mango',
  'matcha latte cold foam fresa': 'Cold foam de fresa',
  'matcha latte cold foam mango': 'Cold foam de mango',
  'matcha ceremonial': 'Ceremonial',
};

function family(product: CatalogProduct) {
  if (normalizeMenuText(product.category ?? '') !== 'bebidas') return;
  const originalName = normalizeMenuText(product.name);
  const sizeMatch = /\b(16|20)\s*oz\s*$/i.exec(product.name);
  const size: DrinkSize | undefined = sizeMatch ? `${sizeMatch[1]} oz` as DrinkSize
    : originalName === 'matcha carino' ? '16 oz' : undefined;
  const displayName = product.name.replace(/\s*[·-]?\s*\b(?:16|20)\s*oz\s*$/i, '').trim();
  const name = normalizeMenuText(displayName);
  const iced = /^iced coffee?\s*(.*)$/.exec(name);
  if (iced && !/^nevado\b/.test(iced[1])) {
    const flavor = displayName.replace(/^iced coffee?\s*/i, '').trim();
    const label = name === 'iced coffee nuez' ? 'Butter Pecan (nuez)' : flavor ? flavor[0].toUpperCase() + flavor.slice(1) : 'Original';
    return { key: 'iced-coffee', title: 'Iced Coffee', prompt: 'Elige el sabor', label, size };
  }
  const nevado = /^(?:iced coffee? )?nevado\b\s*(.*)$/.exec(name);
  if (nevado) return { key: 'nevado', title: 'Nevado', prompt: 'Elige la preparación', label: nevado[1] ? product.name : 'Original · 20 oz' };
  if (/^matcha\b/.test(name)) return { key: 'matcha', title: 'Matcha', prompt: 'Elige la preparación', label: matchaLabels[name] ?? displayName, size };
  if (/^(frappe|frappuccino)\b/.test(name)) return { key: 'frappuccino', title: 'Frappuccino · 16 oz', prompt: 'Elige el sabor', label: name.endsWith('oreo') ? 'Oreo' : name.endsWith('original') ? 'Tradicional' : product.name };
  if (/^te chai (caliente|frio)$/.test(name)) return { key: 'chai-latte', title: 'Chai Latte · 16 oz', prompt: 'Elige la temperatura', label: name.endsWith('frio') ? 'Frío' : 'Caliente' };
}

export function menuCards(products: readonly CatalogProduct[]): MenuCard[] {
  const singles: MenuCard[] = [];
  const families = new Map<string, { title: string; prompt: string; variants: MenuVariant[] }>();
  for (const product of products) {
    if (!product.is_active) continue;
    const group = family(product);
    if (!group) { singles.push(product); continue; }
    const current = families.get(group.key) ?? { ...group, variants: [] };
    current.variants.push({ product, label: group.label, ...('size' in group && group.size ? { size: group.size } : {}) });
    families.set(group.key, current);
  }
  for (const [key, { title, prompt, variants }] of families) {
    variants.sort((a, b) => Number(a.product.price) - Number(b.product.price) || a.label.localeCompare(b.label, 'es'));
    const first = variants[0].product;
    if (variants.length === 1) {
      singles.push(key === 'nevado' ? { ...first, name: 'Nevado · 20 oz', variants } : first);
      continue;
    }
    const available = variants.filter(v => productAvailable(v.product));
    const prices = (available.length ? available : variants).map(v => Number(v.product.price));
    const image = variants.find(v => v.product.image_url)?.product.image_url;
    singles.push({ ...first, id: `family:${key}`, name: title, image_url: image, price: Math.min(...prices), inventory: undefined, variants,
      variantTitle: prompt, fromPrice: Math.min(...prices) !== Math.max(...prices) });
  }
  return singles.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function menuCardAvailable(card: MenuCard) {
  return card.variants ? card.variants.some(v => productAvailable(v.product)) : productAvailable(card);
}

export function matchesMenuCard(card: MenuCard, search: string) {
  const term = normalizeMenuText(search);
  return normalizeMenuText(card.name).includes(term) || (card.variants ?? []).some(v =>
    normalizeMenuText(v.product.name).includes(term) || normalizeMenuText(v.label).includes(term));
}

export function menuCardPrice(card: MenuCard) {
  return `${card.fromPrice ? 'Desde ' : ''}$${Number(card.price).toFixed(2)}`;
}

export function favoriteMenuCards(cards: readonly MenuCard[], productIds: readonly string[]) {
  const byProduct = new Map<string, MenuCard>();
  for (const card of cards) {
    for (const product of card.variants?.map(v => v.product) ?? [card]) byProduct.set(product.id, card);
  }
  return [...new Set(productIds.slice(0, 8).flatMap(id => byProduct.get(id) ?? []))];
}
