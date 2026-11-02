import { create } from 'zustand';

export interface CartExtra {
  id?: string;
  phase?: string;
  name: string;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url?: string;
  basePrice?: number;
  displayExtras?: CartExtra[];
  note?: string;
  customizable?: boolean;
  wizard_steps?: string[];
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  orderType: string;
  orderNote: string;
  pagerNumber: number | null;
  customerId: string | null;
  setOrderType: (value: string) => void;
  setOrderNote: (value: string) => void;
  setPagerNumber: (value: number | null) => void;
  setCustomerId: (value: string | null) => void;
  addItem: (product: Product) => void;
  removeItem: (itemId: string) => void;
  replaceItem: (itemId: string, product: Product, quantity?: number) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
}

const cents = (amount: number) => Math.round(amount * 100);

function samePreparation(left: Product, right: Product) {
  const extrasKey = (product: Product) => JSON.stringify(
    (product.displayExtras ?? []).map(extra =>
      JSON.stringify([extra.id ?? null, extra.phase ?? null, extra.name, cents(extra.price)])
    ).sort()
  );
  return left.id === right.id && cents(left.price) === cents(right.price)
    && (left.note ?? '').trim() === (right.note ?? '').trim()
    && extrasKey(left) === extrasKey(right);
}

export function customizeProduct(product: Product, extras: CartExtra[], note: string): Product {
  const basePrice = product.basePrice ?? Number(product.price)
    - (product.displayExtras ?? []).reduce((sum, extra) => sum + Number(extra.price), 0);
  return {
    ...product,
    basePrice,
    price: (cents(basePrice) + extras.reduce((sum, extra) => sum + cents(extra.price), 0)) / 100,
    displayExtras: extras.map(extra => ({ ...extra })),
    note,
  };
}

export const createCartStore = () => create<CartStore>((set, get) => ({
  items: [],
  orderType: 'En Local', orderNote: '', pagerNumber: null, customerId: null,
  setOrderType: orderType => set({ orderType }),
  setOrderNote: orderNote => set({ orderNote }),
  setPagerNumber: pagerNumber => set({ pagerNumber }),
  setCustomerId: customerId => set({ customerId }),
  
  addItem: (product) => {
    set((state) => {
      const existing = state.items.find(item => samePreparation(item.product, product));

      if (existing) {
        return { 
          items: state.items.map(i => i.id === existing.id 
            ? {...i, quantity: i.quantity + 1} 
            : i
          ) 
        };
      }

      return { 
        items: [
          ...state.items, 
          { id: crypto.randomUUID(), product, quantity: 1 }
        ] 
      };
    });
  },

  removeItem: (itemId) => set((state) => ({ 
    items: state.items.filter(i => i.id !== itemId) 
  })),

  // Commit the edited product and quantity together so draft persistence sees one change.
  replaceItem: (itemId, product, quantity) => set(state => ({
    items: state.items.map(item => item.id === itemId ? { ...item, product,
      quantity: quantity !== undefined && Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : item.quantity } : item),
  })),

  updateQuantity: (itemId, qty) => set((state) => ({
    items: state.items.map(i => i.id === itemId && Number.isFinite(qty)
      ? { ...i, quantity: Math.max(1, Math.floor(qty)) }
      : i
    )
  })),

  clearCart: () => set({ items: [], orderType: 'En Local', orderNote: '', pagerNumber: null, customerId: null }),

  getTotal: () => get().items.reduce((acc, item) => 
    acc + cents(item.product.price) * item.quantity, 0
  ) / 100,
}));

export const useCartStore = createCartStore();
