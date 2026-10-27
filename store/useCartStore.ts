import { create } from 'zustand';

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url?: string;
  stock: number;
  displayExtras?: { name: string; price: number }[]; // Para guardar los extras seleccionados
}

export interface CartItem {
  id: string; // Este ID será único para cada combinación (ej: Americano + Vainilla)
  product: Product;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  
  addItem: (product) => {
    set((state) => {
      // 1. Creamos una "firma" única basada en los extras para saber si es el mismo pedido exacto
      const extrasKey = product.displayExtras?.map(e => e.name).sort().join(',') || '';
      
      // 2. Buscamos si ya existe ese producto CON ESOS MISMOS EXTRAS
      const existing = state.items.find(i => 
        i.product.id === product.id && 
        (i.product.displayExtras?.map(e => e.name).sort().join(',') || '') === extrasKey
      );

      if (existing) {
        return { 
          items: state.items.map(i => i.id === existing.id 
            ? {...i, quantity: i.quantity + 1} 
            : i
          ) 
        };
      }

      // 3. Si es una combinación nueva, lo agregamos como un ítem único
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

  updateQuantity: (itemId, qty) => set((state) => ({
    items: state.items.map(i => i.id === itemId 
      ? { ...i, quantity: Math.max(1, qty) } 
      : i
    )
  })),

  clearCart: () => set({ items: [] }),

  getTotal: () => get().items.reduce((acc, item) => 
    acc + (item.product.price * item.quantity), 0
  ),
}));