import type { Product } from '../store/useCartStore';

// UI query projections, aligned with the verified schema and receipt contract.
// Nullable legacy fields stay nullable; their display defaults are explicit.
export interface ProductRow {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  category: string | null;
  image_url: string | null;
  is_active: boolean | null;
  customizable: boolean | null;
  wizard_steps: string[] | null;
}
export interface ExtraRow {
  id: string;
  name: string;
  price: number | null;
  phase: string;
  active: boolean | null;
}
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
  role: string | null;
  is_active: boolean;
}
export interface Supply {
  id: string;
  name: string;
  unit: string;
  current_stock: number | null;
  min_stock: number | null;
  cost_per_unit: number | null;
  is_active?: boolean;
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
export interface CostProduct {
  id: string;
  name: string;
  price: number;
  category: string | null;
  totalCost: number;
  margin: number;
}
export interface WizardStep {
  id: string;
  title: string;
  options: string[];
  exclusive: boolean;
}
export type CatalogProduct = Product & { is_active: boolean };

export function catalogProduct(row: ProductRow): CatalogProduct {
  return { ...row, stock: row.stock ?? 0, category: row.category ?? '',
    image_url: row.image_url ?? undefined, is_active: row.is_active === true,
    customizable: row.customizable === true, wizard_steps: row.wizard_steps ?? [] };
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'No se pudo completar la operación.';
}
