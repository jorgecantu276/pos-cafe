import { proxiedCatalogPhoto } from './supabase-connection';
import { posProfile } from './pos-profile';
// Temporary, illustrative stock photos. Merchant URLs and database rows stay unchanged.
export function stockProductPhoto(name: string, category = ''): string {
  const text = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let photo: string;
  if (/cheesecake/.test(text)) photo = 'cheesecake';
  else if (/brownie|tortuguita/.test(text)) photo = 'brownie';
  else if (/galleta/.test(text)) photo = 'cookie';
  else if (/crookie|hojaldre|danish/.test(text)) photo = 'pastry';
  else if (/muffin/.test(text)) photo = 'muffin';
  else if (/nue?besita/.test(text)) photo = 'marshmallow';
  else if (/dona/.test(text)) photo = 'donut';
  else if (/arroz/.test(text)) photo = 'rice-pudding';
  else if (/rosca/.test(text)) photo = 'bundt-cake';
  else if (/cake/.test(text)) photo = 'chocolate-cake';
  else if (/matcha/.test(text)) photo = 'matcha';
  else if (/frappe|nevado/.test(text)) photo = 'frappe';
  else if (/iced coff/.test(text)) photo = 'iced-coffee';
  else if (/chai/.test(text)) photo = /frio/.test(text) ? 'iced-coffee' : 'chai';
  else if (/cappuccino/.test(text)) photo = 'cappuccino';
  else if (/americano|cafe|coffee/.test(text)) photo = 'black-coffee';
  else if (/agua|topo\s?chico/.test(text)) photo = 'water';
  else if (/coca|cola/.test(text)) photo = 'soda';
  else if (/proteina|nurri/.test(text)) photo = 'milk';
  else if (/arizona|kool/.test(text)) photo = 'juice';
  else photo = category.toLowerCase() === 'bebidas' ? 'iced-coffee' : 'pastry';
  return `/product-photos/${photo}.webp`;
}

export function productPhotoSource(url: string | null | undefined, fallback: string): string {
  const value = url?.trim();
  if (!value) return fallback;
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (['https:', 'http:'].includes(parsed.protocol)) return posProfile.id === 'smoothies' ? proxiedCatalogPhoto(value, process.env.NEXT_PUBLIC_SUPABASE_URL || '') : value;
  } catch { /* Invalid merchant URL: use the bundled photo. */ }
  return fallback;
}
