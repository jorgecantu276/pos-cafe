import type { Product } from '../store/useCartStore';

// UI query projections, aligned with the verified schema and receipt contract.
// Nullable legacy fields stay nullable; their display defaults are explicit.
export interface ProductRow {
  catalog_revision?:number;
  pos_inventory_items?: Product['inventory'] | Product['inventory'][];
  id: string;
  name: string;
  price: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean | null;
  customizable: boolean | null;
  wizard_steps: string[] | null;
}
export interface ExtraRow {
  applicable_product_ids?: string[] | null;
  catalog_revision?:number;
  id: string;
  name: string;
  price: number | null;
  phase: string;
  active: boolean | null;
}
export const extraAppliesToProduct = (extra: ExtraRow, productId: string) =>
  extra.applicable_product_ids == null || extra.applicable_product_ids.includes(productId);

export const isSmoothie = (product: { category?: string | null }) => product.category?.trim().toLowerCase() === 'smoothies';
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  customer_code: string | null;
  birth_date: string | null;
  points: number | null;
  total_spent: number | null;
  accept_promos: boolean | null;
}
export interface LoginProfile {
  id: string;
  full_name: string;
  username: string | null;
  avatar_url: string | null;
}
export interface StaffProfile extends LoginProfile {
  management_revision?:number;
  role: string | null;
  is_active: boolean;
}
export interface SaleItem {
  product_id?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  notes: string | null;
  product_snapshot: Product | null;
  products: { name: string } | { name: string }[] | null;
}
export interface Sale {
  id: string;
  ticket_number: number;
  created_at: string;
  total: number;
  payment_method: string | null;
  status: string | null;
  order_items: SaleItem[];
}
export interface Expense { desc: string; amount: number }
export interface ShiftDraft {
  startingCash: number;
  shiftStartTime: string;
  expenses: Expense[];
}
export interface PastShift {
  id: string;
  created_at: string;
  user_name: string | null;
  total_sales: number;
  difference: number;
}
export interface Coupon {
  id: string;
  code: string;
  discount_type: string | null;
  value: number;
  expiry_date: string | null;
  active: boolean | null;
}
export interface WizardStep {
  id: string;
  title: string;
  options: string[];
  exclusive: boolean;
  required?: boolean;
}
export type CatalogProduct = Product & { is_active: boolean };

export function validPagerNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30;
}

export function catalogProduct(row: ProductRow): CatalogProduct {
  return { id: row.id, name: row.name, price: row.price, category: row.category ?? '',
    image_url: row.image_url ?? undefined, is_active: row.is_active === true,
    customizable: row.customizable === true, wizard_steps: row.wizard_steps ?? [],
    inventory: (Array.isArray(row.pos_inventory_items) ? row.pos_inventory_items[0] : row.pos_inventory_items) ?? undefined };
}

export function productAvailable(product: Product) {
  const i = product.inventory;
  return !i || (i.mode === 'availability' ? i.available : i.quantity === null || i.quantity > 0);
}
export function productStockLabel(product: Product) {
  if (!productAvailable(product)) return 'Agotado';
  const i = product.inventory;
  return i?.mode === 'counted' ? i.quantity === null ? 'Sin contar' : `${i.quantity} disponibles` : '';
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const message=error.message;
    if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|econnrefused|enotfound/i.test(message)) return 'No hay conexión. Vuelve a intentar.';
    if (/jwt expired|invalid refresh token|refresh token not found|auth session missing/i.test(message)) return 'Tu sesión terminó. Inicia sesión de nuevo.';
    if (/permission denied|administrator required|staff required/i.test(message)) return 'No tienes permiso para hacer este cambio.';
    return message;
  }
  return 'No se pudo completar la operación.';
}
