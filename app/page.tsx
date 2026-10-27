'use client';

import { useEffect, useState } from 'react';
import { useCartStore } from '@/store/useCartStore';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { 
  Coffee, Minus, Plus, Trash2, CreditCard, ShoppingBag, 
  Loader2, Search, X, UserPlus, Edit3, LogOut, Wallet, 
  DollarSign, CheckCircle2, Printer, Tag, ChevronRight, ChevronLeft, Receipt
} from 'lucide-react';

// DENOMINACIONES DE DINERO
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50];

export default function POSPage() {
  const { items, addItem, removeItem, updateQuantity, getTotal, clearCart } = useCartStore();
  const router = useRouter();
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 🟢 FUNCIÓN ROBUSTA PARA PARSEAR DINERO (Evita errores de NaN y comas decimales)
  const parseAmount = (val: any) => {
    if (val === '' || val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const parsed = Number(String(val).replace(/,/g, '.'));
    return isNaN(parsed) ? 0 : parsed;
  };

  const [products, setProducts] = useState<any[]>([]);
  const [dbExtras, setDbExtras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketSearchTerm, setTicketSearchTerm] = useState(''); // 🟢 ESTADO PARA BUSCAR TICKET
  const [userName, setUserName] = useState('Barista');

  // ESTADOS DE TURNO
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [showApertura, setShowApertura] = useState(false);
  const [showCierre, setShowCierre] = useState(false);
  const [todaysSales, setTodaysSales] = useState(0);
  
  // DATOS DEL DINERO Y ARQUEO
  const [shiftStartTime, setShiftStartTime] = useState<string | null>(null);
  const [startingCash, setStartingCash] = useState(0); 
  const [exchangeRate, setExchangeRate] = useState('');
  const [dollarsInBox, setDollarsInBox] = useState<number | ''>('');
  const [breakdown, setBreakdown] = useState<{[key: number]: number}>(
    DENOMINATIONS.reduce((acc, den) => ({ ...acc, [den]: 0 }), {})
  );

  // GASTOS DEL TURNO
  const [expenses, setExpenses] = useState<{desc: string, amount: number}[]>([]);
  const [newExpense, setNewExpense] = useState({desc: '', amount: ''});

  // ESTADOS PARA EL CHECKOUT
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [amountReceivedMXN, setAmountReceivedMXN] = useState<string | number>('');
  const [amountReceivedUSD, setAmountReceivedUSD] = useState<string | number>('');
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>('');
  
  // ESTADOS DE ORDEN (Checkout)
  const [orderType, setOrderType] = useState('En Local');
  const [orderNote, setOrderNote] = useState('');

  // ESTADOS PARA AUTOCOMPLETADO DE CLIENTES
  const [customerSuggestions, setCustomerSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ESTADOS PARA IMPRESIÓN Y PERSONALIZACIÓN
  const [showPostSaleModal, setShowPostSaleModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [activeExtras, setActiveExtras] = useState<{name: string, price: number}[]>([]);
  const [productNote, setProductNote] = useState(''); 
  const [customizationStep, setCustomizationStep] = useState(0);

  // WIZARD DINÁMICO
  const [dynamicSteps, setDynamicSteps] = useState<any[]>([]);
  const lastStepIndex = dynamicSteps.length > 0 ? dynamicSteps.length - 1 : 0;

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.replace('/login');
        return;
      }

      setUserName(user.email?.split('@')[0] || 'Barista');

      const { data: pData } = await supabase.from('products').select('*').order('name');
      const { data: eData } = await supabase.from('extras').select('*').order('phase');
      
      setProducts(pData || []);
      setDbExtras(eData || []);
      
      // MEMORIA
      const savedShift = localStorage.getItem('mi_cafe_shift');
      if (savedShift) {
        const parsedShift = JSON.parse(savedShift);
        setIsShiftActive(true);
        setShiftStartTime(parsedShift.shiftStartTime);
        setStartingCash(parsedShift.startingCash);
        setExchangeRate(parsedShift.exchangeRate);
        setDollarsInBox(parsedShift.dollarsInBox);
        setBreakdown(parsedShift.breakdown);
        setExpenses(parsedShift.expenses || []);
        setShowApertura(false);
      } else {
        setShowApertura(true);
      }
      
    } catch (error: any) { console.error(error.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const calculateTotalCash = () => {
    const pesos = Object.entries(breakdown).reduce((sum, [den, qty]) => sum + (Number(den) * qty), 0);
    const dollarsToPesos = parseAmount(dollarsInBox) * parseAmount(exchangeRate);
    return pesos + dollarsToPesos;
  };

  const handleStartShift = () => {
    if (!exchangeRate || parseAmount(exchangeRate) <= 0) {
      alert("Por favor, introduce un Tipo de Cambio válido.");
      return;
    }
    
    const calculatedCash = calculateTotalCash();
    const startTime = new Date().toISOString();
    
    setStartingCash(calculatedCash);
    setShiftStartTime(startTime);
    
    localStorage.setItem('mi_cafe_shift', JSON.stringify({
      shiftStartTime: startTime,
      startingCash: calculatedCash,
      exchangeRate,
      dollarsInBox,
      breakdown,
      expenses: []
    }));
    
    setBreakdown(DENOMINATIONS.reduce((acc, den) => ({ ...acc, [den]: 0 }), {}));
    setDollarsInBox('');
    
    setIsShiftActive(true);
    setShowApertura(false);
  };

  const handleAddExpense = () => {
    if (!newExpense.desc || !newExpense.amount) return;
    
    const updatedExpenses = [...expenses, { desc: newExpense.desc, amount: Number(newExpense.amount) }];
    setExpenses(updatedExpenses);
    
    const savedShift = localStorage.getItem('mi_cafe_shift');
    if (savedShift) {
      const parsed = JSON.parse(savedShift);
      parsed.expenses = updatedExpenses;
      localStorage.setItem('mi_cafe_shift', JSON.stringify(parsed));
    }
    
    setNewExpense({ desc: '', amount: '' });
  };

  const handleOpenCierre = async () => {
    const queryTime = shiftStartTime || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    
    const { data } = await supabase
      .from('orders')
      .select('total, status')
      .gte('created_at', queryTime);
      
    // Solo sumamos las órdenes que NO estén canceladas
    const total = data?.reduce((sum, o) => {
        if (o.status === 'canceled') return sum;
        return sum + Number(o.total);
    }, 0) || 0;

    setTodaysSales(total);
    setShowCierre(true);
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('mi_cafe_shift');
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      window.location.href = '/login';
    }
  };

  // 🟢 LA MATEMÁTICA PROTEGIDA DEL CIERRE (Para usarse en el reporte y la pantalla)
  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const expectedCash = startingCash + todaysSales - totalExpenses;
  const countedCash = calculateTotalCash();
  const difference = countedCash - expectedCash;

  // 🟢 NUEVA FUNCIÓN: REPORTE DE CORTE Z
  const printZReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const endDate = new Date();
    const startDate = shiftStartTime ? new Date(shiftStartTime) : endDate;

    const formatTime = (d: Date) => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
    const formatDate = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const content = `
      <div style="width: 85mm; font-family: 'Helvetica', 'Arial', sans-serif; color: #000; padding: 10px; margin: 0 auto; line-height: 1.4;">
        
        <div style="text-align: center; margin-bottom: 15px;">
          <img src="https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg" style="width: 180px; margin-bottom: 10px;">
          <h1 style="font-size: 20px; margin: 0; font-weight: 900; text-transform: uppercase;">Corte de Caja (Z)</h1>
          <p style="font-size: 11px; margin: 5px 0;">Cariñito Mío - Matamoros</p>
        </div>

        <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>

        <div style="font-size: 12px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between;">
            <span><b>Fecha:</b> ${formatDate(endDate)}</span>
            <span><b>Cajero:</b> ${userName}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 4px;">
            <span><b>Apertura:</b> ${formatTime(startDate)}</span>
            <span><b>Cierre:</b> ${formatTime(endDate)}</span>
          </div>
        </div>

        <div style="border-top: 2px solid #000; margin: 10px 0;"></div>

        <div style="font-size: 14px; margin-bottom: 10px;">
          <div style="text-transform: uppercase; font-size: 10px; font-weight: 900; color: #666; margin-bottom: 5px;">Resumen Financiero</div>
          
          <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
            <span>Fondo Inicial:</span>
            <span>$${startingCash.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
            <span>(+) Ventas del Turno:</span>
            <span>$${todaysSales.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
            <span>(-) Retiros/Gastos:</span>
            <span>-$${totalExpenses.toFixed(2)}</span>
          </div>
          
          <div style="border-top: 1px dashed #ccc; margin: 5px 0;"></div>
          
          <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 16px;">
            <span>Efectivo Esperado:</span>
            <span>$${expectedCash.toFixed(2)}</span>
          </div>
        </div>

        <div style="border-top: 2px solid #000; margin: 10px 0;"></div>

        <div style="font-size: 14px; margin-bottom: 10px;">
          <div style="text-transform: uppercase; font-size: 10px; font-weight: 900; color: #666; margin-bottom: 5px;">Arqueo de Caja</div>
          
          <div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 5px;">
            <span>Efectivo Contado:</span>
            <span>$${countedCash.toFixed(2)}</span>
          </div>
          
          <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 15px;">
            <span>Diferencia:</span>
            <span>${difference > 0 ? '+' : ''}$${difference.toFixed(2)}</span>
          </div>
        </div>

        ${expenses.length > 0 ? `
          <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>
          <div style="font-size: 12px; margin-bottom: 10px;">
            <div style="text-transform: uppercase; font-size: 10px; font-weight: 900; color: #666; margin-bottom: 5px;">Detalle de Gastos</div>
            ${expenses.map(e => `
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span style="flex: 1; padding-right: 10px; word-break: break-all;">${e.desc}</span>
                <span>$${e.amount.toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 35px;">
          <p style="font-size: 11px; margin-bottom: 25px;">Firma del Cajero</p>
          <div style="border-bottom: 1px solid #000; width: 80%; margin: 0 auto 5px auto;"></div>
          <p style="font-size: 11px; font-weight: bold;">${userName}</p>
          <p style="font-size: 9px; margin-top: 15px; color: #666; line-height: 1.2;">
            Documento de control interno.<br>Mi Café OS • 2026
          </p>
        </div>

      </div>
    `;

    printWindow.document.write(`
      <html>
        <head>
          <title>Corte Z - ${userName}</title>
          <style>
            @page { margin: 0; }
            body { margin: 0; padding: 0; }
          </style>
        </head>
        <body onload="window.print();window.close()">
          ${content}
        </body>
      </html>
    `);
    printWindow.document.close();
  };

const handleSaveAndClose = async () => {
    // 1. Imprime el ticket Z
    printZReport();

    // 2. Guardar el historial en Supabase
    try {
      await supabase.from('shifts').insert([{
        opened_at: shiftStartTime,
        starting_cash: startingCash,
        total_sales: todaysSales,
        total_expenses: totalExpenses,
        expected_cash: expectedCash,
        counted_cash: countedCash,
        difference: difference,
        expenses_detail: expenses,
        user_name: userName
      }]);
    } catch (error) {
      console.error("Error al guardar el turno en el historial:", error);
    }

    // 3. Borra la memoria y cierra la sesión
    await handleLogout();
  };

  const [customerSearch, setCustomerSearch] = useState('');
  const [activeCustomer, setActiveCustomer] = useState<any>(null);
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [customerForm, setCustomerForm] = useState({ firstName: '', lastName: '', birthDate: '', whatsapp: '', acceptPromos: false });

  const handleCustomerSearchInput = async (value: string) => {
    setCustomerSearch(value);
    if (value.length < 2) {
      setCustomerSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setShowSuggestions(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or(`name.ilike.%${value}%,customer_code.ilike.%${value}%,phone.ilike.%${value}%`)
        .limit(5);

      if (!error && data) {
        setCustomerSuggestions(data);
      }
    } catch (err) { console.error(err); }
  };

  const selectCustomer = (customer: any) => {
    setActiveCustomer(customer);
    setCustomerSearch('');
    setCustomerSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSearchCustomer = async () => {
    if (!customerSearch) return;
    setIsSearchingCustomer(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or(`customer_code.eq.${customerSearch.toUpperCase()},phone.eq.${customerSearch},name.ilike.%${customerSearch}%`)
        .limit(1)
        .single();
        
      if (error) throw new Error('No encontrado');
      selectCustomer(data);
    } catch (err: any) { alert('Cliente no encontrado'); } 
    finally { setIsSearchingCustomer(false); setShowSuggestions(false); }
  };

  const handleRegisterCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    try {
      const { count } = await supabase.from('customers').select('*', { count: 'exact', head: true });
      const nextNumber = (count || 0) + 1;
      const customerCode = `AA-${nextNumber.toString().padStart(5, '0')}`;
      const { error } = await supabase.from('customers').insert([{
        name: `${customerForm.firstName} ${customerForm.lastName}`,
        birth_date: customerForm.birthDate, phone: customerForm.whatsapp,
        accept_promos: customerForm.acceptPromos, customer_code: customerCode, points: 50 
      }]);
      if (error) throw error;
      alert(`¡Éxito! Código: ${customerCode}`);
      setShowCustomerModal(false);
      setCustomerForm({ firstName: '', lastName: '', birthDate: '', whatsapp: '', acceptPromos: false });
    } catch (error: any) { alert(error.message); }
    finally { setIsRegistering(false); }
  };

  const buildWizardSteps = (product: any) => {
    if (!product.customizable || !product.wizard_steps || product.wizard_steps.length === 0) {
       return [];
    }
    const steps = product.wizard_steps.map((phaseName: string) => {
       const phaseOptions = dbExtras.filter(e => e.phase === phaseName).map(e => e.name);
       return {
          id: phaseName,
          title: `Seleccionar ${phaseName}`,
          options: phaseOptions,
          exclusive: ['Tamaño', 'Tipo de Leche'].includes(phaseName)
       };
    }).filter((step: any) => step.options.length > 0);
    return steps;
  };

  const handleProductClick = (product: any) => {
    const steps = buildWizardSteps(product);
    
    if (steps.length === 0) {
      addItem({ ...product, price: Number(product.price), displayExtras: [], note: '' });
    } else {
      setSelectedProduct(product);
      setActiveExtras([]);
      setProductNote('');
      setDynamicSteps(steps);
      setCustomizationStep(0);
    }
  };

  const handleEditItem = (item: any) => {
    const steps = buildWizardSteps(item.product);
    if (steps.length === 0) return;

    setSelectedProduct(item.product);
    setActiveExtras(item.product.displayExtras || []);
    setProductNote((item.product as any).note || '');
    removeItem(item.id);
    setDynamicSteps(steps);
    setCustomizationStep(0);
  };

  const handleConfirmAdd = () => {
    const extraTotal = activeExtras.reduce((sum, e) => sum + e.price, 0);
    const productWithExtras = { 
      ...selectedProduct, 
      price: Number(selectedProduct.price) + extraTotal, 
      displayExtras: activeExtras,
      note: productNote 
    };
    addItem(productWithExtras);
    setSelectedProduct(null);
    setActiveExtras([]);
    setProductNote('');
  };

  const handleOpenCheckout = () => {
    if (items.length === 0) return;
    setPaymentMethod('Efectivo');
    setAmountReceivedMXN('');
    setAmountReceivedUSD('');
    setOrderType('En Local'); 
    setOrderNote('');         
    setCheckoutStep(1); 
    setShowCheckoutModal(true);
  };

  // 🟢 NUEVA FUNCIÓN: REIMPRIMIR HISTÓRICO (Por ID o Último)
  const reprintHistoricalTicket = async (ticketNum?: string) => {
    try {
      let query = supabase.from('orders').select('*, order_items(quantity, unit_price, total_price, products(name))');
      
      if (ticketNum) {
        query = query.eq('ticket_number', parseInt(ticketNum));
      } else {
        query = query.order('created_at', { ascending: false }).limit(1);
      }

      const { data, error } = await query.single();
      
      if (error || !data) {
        alert('Ticket no encontrado. Por favor verifica el folio.');
        return;
      }

      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      const ticketDate = new Date(data.created_at).toLocaleString('es-MX', { 
        day: '2-digit', month: '2-digit', year: 'numeric', 
        hour: '2-digit', minute: '2-digit', hour12: true 
      });

      const formattedTicketId = String(data.ticket_number).padStart(4, '0');

      const content = `
        <div style="width: 85mm; font-family: 'Helvetica', 'Arial', sans-serif; color: #000; padding: 10px; margin: 0 auto; line-height: 1.4;">
          <div style="text-align: center; margin-bottom: 15px;">
            <img src="https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg" style="width: 180px; margin-bottom: 10px;">
            <h1 style="font-size: 24px; margin: 0; font-weight: 900;">Cariñito Mío</h1>
            <p style="font-size: 11px; margin: 5px 0;">Calle Fuerza Aérea #37, Fraccionamiento Moderno,<br>H. Matamoros, Tam, México, 87380</p>
            <div style="display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 13px; font-weight: bold;">
               <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" style="width: 14px;">+52 868 305 4668
            </div>
            <div style="margin-top: 5px; font-size: 10px; font-weight: bold; border: 1px solid #000; display: inline-block; padding: 2px 5px;">REIMPRESIÓN</div>
            ${data.status === 'canceled' ? '<div style="margin-top: 5px; background: #000; color: #fff; padding: 2px; font-weight: bold; text-transform: uppercase;">*** CANCELADO ***</div>' : ''}
          </div>
          <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>
          <div style="font-size: 12px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between;">
              <span><b>Folio:</b> #${formattedTicketId}</span>
              <span><b>Fecha:</b> ${ticketDate}</span>
            </div>
          </div>
          <div style="border-top: 2px solid #000; margin: 10px 0;"></div>
          <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #eee;">
                <th style="text-align: left; padding: 5px 0;">Cant.</th><th style="text-align: left; padding: 5px 0;">Producto</th><th style="text-align: right; padding: 5px 0;">Importe</th>
              </tr>
            </thead>
            <tbody>
              ${data.order_items.map((i: any) => {
                const pInfo = Array.isArray(i.products) ? i.products[0] : i.products;
                return `
                <tr style="vertical-align: top;">
                  <td style="padding: 8px 0; font-weight: bold;">${i.quantity}</td>
                  <td style="padding: 8px 0;"><div style="font-weight: bold;">${pInfo?.name || 'Producto'}</div></td>
                  <td style="padding: 8px 0; text-align: right;">$${Number(i.total_price || 0).toFixed(2)}</td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
          <div style="border-top: 2px solid #000; margin: 10px 0;"></div>
          <div style="font-size: 14px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 18px; margin-bottom: 5px;">
              <span>TOTAL MXN:</span><span>$${Number(data.total).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px; color: #444; font-size: 12px; font-weight: bold;">
              <span>Método de Pago:</span><span style="text-transform: uppercase;">${data.payment_method || 'N/A'}</span>
            </div>
          </div>
          <div style="text-align: center; margin-top: 25px;">
            <p style="font-size: 11px; font-weight: bold; margin-bottom: 10px;">¡Síguenos en Instagram!</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://www.instagram.com/_carinitomio/" style="width: 100px;">
            <p style="font-size: 10px; font-weight: bold; margin-top: 10px;">¡GRACIAS POR TU VISITA!</p>
          </div>
        </div>
      `;

      printWindow.document.write(`
        <html><head><title>Reimpresión - #${formattedTicketId}</title><style>@page { margin: 0; } body { margin: 0; padding: 0; }</style></head>
        <body onload="window.print();window.close()">${content}</body></html>
      `);
      printWindow.document.close();
      setTicketSearchTerm(''); // Limpiar buscador tras imprimir
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const handlePrint = (type: 'ticket' | 'sticker') => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const ticketDate = new Date().toLocaleString('es-MX', { 
      day: '2-digit', month: '2-digit', year: 'numeric', 
      hour: '2-digit', minute: '2-digit', hour12: true 
    });

    let content = '';

    if (type === 'ticket') {
      content = `
        <div style="width: 85mm; font-family: 'Helvetica', 'Arial', sans-serif; color: #000; padding: 10px; margin: 0 auto; line-height: 1.4;">
          
          <div style="text-align: center; margin-bottom: 15px;">
            <img src="https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg" style="width: 180px; margin-bottom: 10px;">
            <h1 style="font-size: 24px; margin: 0; font-weight: 900;">Cariñito Mío</h1>
            <p style="font-size: 11px; margin: 5px 0;">Calle Fuerza Aérea #37, Fraccionamiento Moderno,<br>H. Matamoros, Tam, México, 87380</p>
            <div style="display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 13px; font-weight: bold;">
               <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" style="width: 14px;">
               +52 868 305 4668
            </div>
          </div>

          <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>

          <div style="font-size: 12px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between;">
              <span><b>Folio:</b> #${lastOrderId || 'TEMP'}</span>
              <span><b>Fecha:</b> ${ticketDate}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 4px;">
              <span><b>Te atendió:</b> ${userName}</span>
              <span style="font-weight: 900; background: #000; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase;">
                ${orderType}
              </span>
            </div>
          </div>

          <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>

          <div style="font-size: 12px; margin-bottom: 10px;">
            <div style="text-transform: uppercase; font-size: 10px; font-weight: 900; color: #666; margin-bottom: 3px;">Datos del Cliente</div>
            <div><b>Cliente:</b> ${activeCustomer?.name || 'Venta al Mostrador'}</div>
            ${activeCustomer ? `<div><b>Puntos totales:</b> ${activeCustomer.points} pts</div>` : ''}
          </div>

          <div style="border-top: 2px solid #000; margin: 10px 0;"></div>

          <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #eee;">
                <th style="text-align: left; padding: 5px 0;">Cant.</th>
                <th style="text-align: left; padding: 5px 0;">Producto</th>
                <th style="text-align: right; padding: 5px 0;">Importe</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(i => `
                <tr style="vertical-align: top;">
                  <td style="padding: 8px 0; font-weight: bold;">${i.quantity}</td>
                  <td style="padding: 8px 0;">
                    <div style="font-weight: bold;">${i.product.name}</div>
                    <div style="font-size: 10px; color: #444;">
                      ${i.product.displayExtras?.map((e: any) => `+ ${e.name}`).join(', ') || ''}
                    </div>
                  </td>
                  <td style="padding: 8px 0; text-align: right;">$${(i.product.price * i.quantity).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          ${orderNote ? `
          <div style="margin: 10px 0; padding: 8px; border: 1px dashed #000; border-radius: 4px; font-size: 12px;">
             <b>Nota de Orden:</b> ${orderNote}
          </div>
          ` : ''}

          <div style="border-top: 2px solid #000; margin: 10px 0;"></div>

          <div style="font-size: 14px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 18px; margin-bottom: 5px;">
              <span>TOTAL MXN:</span>
              <span>$${getTotal().toFixed(2)}</span>
            </div>

            ${amountReceivedUSD ? `
              <div style="display: flex; justify-content: space-between; color: #444; font-size: 12px; margin-top: 5px;">
                <span>Total en USD:</span>
                <span>$${(getTotal() / parseAmount(exchangeRate)).toFixed(2)} USD</span>
              </div>
              <div style="display: flex; justify-content: space-between; color: #444; font-size: 12px;">
                <span>Tipo de Cambio:</span>
                <span>$${parseAmount(exchangeRate).toFixed(2)}</span>
              </div>
            ` : ''}

            <div style="display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 5px;">
              <span>Recibimos:</span>
              <span>$${totalReceivedCombinedMXN.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-weight: bold;">
              <span>Cambio:</span>
              <span>$${(totalReceivedCombinedMXN - getTotal()).toFixed(2)}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-top: 5px; color: #444; font-size: 12px; font-weight: bold;">
              <span>Método de Pago:</span>
              <span>${paymentMethod}</span>
            </div>
          </div>

          <div style="text-align: center; margin-top: 25px;">
            <p style="font-size: 11px; font-weight: bold; margin-bottom: 10px;">¡Síguenos en Instagram!</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://www.instagram.com/_carinitomio/" style="width: 100px;">
            <p style="font-size: 9px; margin-top: 20px; color: #666; line-height: 1.2;">
              Esto no es un comprobante fiscal, si requiere factura solicitarla el mismo día de su compra.
            </p>
            <p style="font-size: 10px; font-weight: bold; margin-top: 10px;">¡GRACIAS POR TU VISITA!</p>
          </div>

        </div>
      `;
    } else {
      content = `
        <div style="width: 50mm; height: 30mm; font-family: sans-serif; padding: 5px; border: 1px solid #eee;">
          ${items.map(i => `
            <div style="margin-bottom: 15px; page-break-after: always;">
              <div style="font-weight: bold; font-size: 14px; text-transform: uppercase;">${i.product.name}</div>
              <div style="font-size: 11px; margin-top: 2px;">
                ${i.product.displayExtras?.map((e: any) => `• ${e.name}`).join('<br>') || 'Personalización Normal'}
              </div>
              <div style="font-size: 10px; margin-top: 5px; border-top: 1px solid #ccc; padding-top: 2px;">
                Cliente: ${activeCustomer?.name || 'Invitado'}
              </div>
              <div style="font-size: 9px; color: #666;">${new Date().toLocaleTimeString()}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Ticket - Cariñito Mío</title>
          <style>
            @page { margin: 0; }
            body { margin: 0; padding: 0; }
          </style>
        </head>
        <body onload="window.print();window.close()">
          ${content}
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const processCheckout = async () => {
    try {
      setIsProcessingCheckout(true);

      const orderTotal = getTotal();
      const newPoints = activeCustomer ? activeCustomer.points + Math.floor(orderTotal / 10) : 0;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([{ 
            total: orderTotal, 
            subtotal: orderTotal, 
            payment_method: paymentMethod.toLowerCase(),
            status: 'completed', 
            customer_id: activeCustomer?.id || null 
        }]).select().single();
      
      if (orderError) throw orderError;

      // 🟢 MODIFICACIÓN AQUÍ: Formatear con ceros a la izquierda (ej. 0005)
      setLastOrderId(String(order.ticket_number).padStart(4, '0'));

      for (const item of items) {
        await supabase.from('order_items').insert({
          order_id: order.id, product_id: item.product.id,
          quantity: item.quantity, unit_price: item.product.price, total_price: item.product.price * item.quantity
        });
        await supabase.rpc('decrement_stock', { row_id: item.product.id, amount: item.quantity });
        await supabase.rpc('process_recipe_stock', { p_product_id: item.product.id, p_quantity: item.quantity });
      }

      if (activeCustomer) {
        await supabase.from('customers').update({ points: newPoints }).eq('id', activeCustomer.id);
      }

      setShowCheckoutModal(false);
      setShowPostSaleModal(true);

    } catch (error: any) { 
      alert(error.message); 
    } finally {
      setIsProcessingCheckout(false);
    }
  };

  const handleNextOrder = () => {
    setShowPostSaleModal(false);
    clearCart();
    setActiveCustomer(null);
    fetchData();
  };

  const removeAccents = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const filteredProducts = products.filter(p => 
    removeAccents(p.name).includes(removeAccents(searchTerm))
  );

  const groupedProducts = filteredProducts.reduce((acc: any, p) => {
    const cat = p.category || "Sin Categoría"; 
    if (!acc[cat]) acc[cat] = []; 
    acc[cat].push(p); 
    return acc;
  }, {});

  // 🟢 LA MATEMÁTICA PROTEGIDA DEL CAMBIO
  const totalReceivedCombinedMXN = parseAmount(amountReceivedMXN) + (parseAmount(amountReceivedUSD) * parseAmount(exchangeRate));
  const isPaymentInsufficient = (paymentMethod === 'Efectivo' || paymentMethod === 'Mixto') && totalReceivedCombinedMXN < getTotal();

  return (
    <div className="flex h-screen bg-[#F5F5F7] text-[#1D1D1F] font-sans antialiased overflow-hidden">
      
      {/* MODAL: APERTURA DE TURNO */}
      {showApertura && (
        <div className="fixed inset-0 bg-[#F5F5F7] z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-[950px] shadow-2xl flex overflow-hidden animate-in fade-in zoom-in-95 duration-500">
            <div className="w-1/3 bg-[#1d1d1f] p-8 text-white flex flex-col justify-between">
              <div className="space-y-6">
                <div className="w-14 h-14 bg-[#0071e3] rounded-[16px] flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <Coffee size={28} />
                </div>
                <h2 className="text-3xl font-semibold tracking-tighter leading-tight">
                  ¡Hola, <span className="text-[#0071e3] block">{userName}</span> bienvenido!
                </h2>
                <p className="text-slate-400 text-xs font-medium leading-relaxed">Inicia el turno verificando el efectivo inicial y el tipo de cambio del día.</p>
              </div>
              <div className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">Mi Café System • 2026</div>
            </div>

            <div className="flex-1 p-8 flex flex-col justify-between max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-6 mb-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest px-1">Tipo de Cambio (MXN/USD) *</label>
                  <div className="relative">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-[#0071e3] w-4 h-4" />
                    <input 
                      type="number" 
                      placeholder="0.00" 
                      className="w-full bg-[#f5f5f7] rounded-xl py-3 pl-10 pr-4 text-base font-black outline-none border-2 border-transparent focus:border-[#0071e3]/20 transition-all"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest px-1">Dólares en Caja (USD)</label>
                  <div className="relative">
                    <Wallet className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input 
                      type="number" 
                      placeholder="0" 
                      className="w-full bg-[#f5f5f7] rounded-xl py-3 pl-10 pr-4 text-base font-black outline-none border-2 border-transparent focus:border-slate-200 transition-all"
                      value={dollarsInBox}
                      onChange={(e) => setDollarsInBox(e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest px-1">Conteo de Efectivo Inicial (Pesos)</label>
                <div className="grid grid-cols-3 gap-3">
                  {DENOMINATIONS.map((den) => (
                    <div key={den} className="relative group">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400 group-focus-within:text-[#0071e3] transition-colors">${den}</span>
                      <input 
                        type="number" 
                        min="0"
                        placeholder="0"
                        className="w-full bg-white border-2 border-slate-100 rounded-xl py-2 pl-10 pr-3 text-right text-base font-black outline-none focus:border-[#0071e3]/30 transition-all shadow-sm"
                        value={breakdown[den] === 0 ? '' : breakdown[den]}
                        onChange={(e) => setBreakdown({ ...breakdown, [den]: e.target.value === '' ? 0 : Number(e.target.value) })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#f5f5f7] p-4 px-6 rounded-[20px] flex justify-between items-center mb-5 border border-slate-100 mt-auto">
                <span className="text-[13px] font-bold text-slate-500 uppercase tracking-widest">Total Apertura</span>
                <span className="text-3xl font-black text-[#1d1d1f] tracking-tighter">${calculateTotalCash().toFixed(2)}</span>
              </div>

              <button 
                onClick={handleStartShift}
                className="w-full bg-[#0071e3] text-white h-14 rounded-[20px] font-bold text-lg shadow-lg shadow-blue-100 hover:bg-[#0077ed] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                Abrir Turno <ArrowRight size={18}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CIERRE DE TURNO CON GASTOS Y ARQUEO */}
      {showCierre && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-[950px] shadow-2xl flex overflow-hidden animate-in zoom-in-95 duration-200">
             
             {/* PANEL IZQUIERDO: RESUMEN Y MATEMÁTICA */}
             <div className="w-1/3 bg-[#1d1d1f] p-8 text-white flex flex-col justify-between">
                <div className="space-y-4">
                  <h2 className="text-2xl font-semibold tracking-tighter mb-4">Resumen del Turno</h2>
                  
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center bg-white/5 p-3 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Fondo Inicial</span>
                      <span className="text-sm font-bold">${startingCash.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center bg-white/5 p-3 rounded-xl">
                      <span className="text-[10px] text-[#06c167] uppercase font-black tracking-widest">+ Ventas</span>
                      <span className="text-sm font-bold text-[#06c167]">${todaysSales.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center bg-white/5 p-3 rounded-xl">
                      <span className="text-[10px] text-red-400 uppercase font-black tracking-widest">- Gastos</span>
                      <span className="text-sm font-bold text-red-400">${totalExpenses.toFixed(2)}</span>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-[10px] uppercase font-black tracking-widest mb-1 text-slate-500">Efectivo Esperado</p>
                      <p className="text-3xl font-black text-white tracking-tighter">${expectedCash.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                   <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">T. Cambio Aplicado: <span className="text-white">${exchangeRate}</span></p>
                   <button onClick={handleLogout} className="flex items-center gap-2 text-red-400 font-bold hover:text-red-300 transition-colors text-sm">
                     <LogOut size={18}/> Cerrar sesión sin Arqueo
                   </button>
                </div>
             </div>

             {/* PANEL DERECHO: GASTOS Y ARQUEO */}
             <div className="flex-1 p-6 lg:p-8 flex flex-col justify-between max-h-[90vh]">
                
                {/* SECCIÓN GASTOS */}
                <div className="bg-[#f5f5f7] p-4 rounded-[20px] border border-slate-100 mb-4">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-2.5">Registrar Gasto (Retiro)</label>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Ej. Garrafón de agua..." className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold outline-none focus:border-[#0071e3]/30 transition-all" value={newExpense.desc} onChange={e => setNewExpense({...newExpense, desc: e.target.value})} />
                    <input type="number" placeholder="$0.00" className="w-24 flex-shrink-0 bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold outline-none focus:border-[#0071e3]/30 text-right transition-all" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: e.target.value})} />
                    <button onClick={handleAddExpense} className="bg-[#1d1d1f] flex-shrink-0 text-white w-10 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><Plus size={16}/></button>
                  </div>
                  
                  {/* LISTA DE GASTOS */}
                  {expenses.length > 0 && (
                    <div className="flex flex-wrap gap-2 max-h-[60px] overflow-y-auto custom-scrollbar pt-3 mt-3 border-t border-slate-200/60">
                      {expenses.map((exp, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-semibold text-slate-600">{exp.desc}</span>
                          <span className="text-[11px] font-black text-red-500">-${exp.amount.toFixed(2)}</span>
                          <button onClick={() => {
                            const updated = expenses.filter((_, idx) => idx !== i);
                            setExpenses(updated);
                            const saved = localStorage.getItem('mi_cafe_shift');
                            if(saved) {
                              const parsed = JSON.parse(saved);
                              parsed.expenses = updated;
                              localStorage.setItem('mi_cafe_shift', JSON.stringify(parsed));
                            }
                          }} className="text-slate-300 hover:text-red-500 transition-colors ml-1"><X size={12}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ARQUEO DE EFECTIVO */}
                <div className="mb-4">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest px-1 block mb-2">Arqueo Final de Efectivo</label>
                  <div className="grid grid-cols-3 gap-3">
                    {DENOMINATIONS.map((den) => (
                      <div key={den} className="relative group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400 group-focus-within:text-[#0071e3] transition-colors">${den}</span>
                        <input 
                          type="number" 
                          min="0"
                          placeholder="0"
                          className="w-full bg-white border-2 border-slate-100 rounded-xl py-2 pl-10 pr-3 text-right text-base font-black outline-none focus:border-[#0071e3]/30 transition-all shadow-sm"
                          value={breakdown[den] === 0 ? '' : breakdown[den]}
                          onChange={(e) => setBreakdown({ ...breakdown, [den]: e.target.value === '' ? 0 : Number(e.target.value) })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* TOTALES */}
                <div className="p-4 bg-[#f5f5f7] rounded-[24px] border border-slate-100 mb-5 mt-auto">
                   <div className="flex justify-between items-center mb-3">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Dólares Finales (USD)</span>
                      <div className="relative w-32">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input 
                          type="number" 
                          placeholder="0"
                          className="w-full bg-white border border-slate-200 focus:border-[#0071e3]/40 rounded-xl py-2 pl-9 pr-3 text-right text-sm font-black outline-none transition-all shadow-sm"
                          value={dollarsInBox}
                          onChange={(e) => setDollarsInBox(e.target.value === '' ? '' : Number(e.target.value))}
                        />
                      </div>
                   </div>
                   
                   <div className="flex justify-between items-center border-t border-slate-200 pt-3">
                      <span className="text-[11px] font-black tracking-widest uppercase text-[#86868b]">Total Contado</span>
                      <div className="flex items-center gap-3">
                         <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-wider ${difference === 0 ? 'bg-green-100 text-green-700' : difference > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                           {difference === 0 ? 'Caja Cuadrada' : difference > 0 ? `Sobrante +$${difference.toFixed(2)}` : `Faltante -$${Math.abs(difference).toFixed(2)}`}
                         </span>
                         <span className="text-2xl font-black text-[#1d1d1f] tracking-tighter">${countedCash.toFixed(2)}</span>
                      </div>
                   </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={() => setShowCierre(false)} className="flex-1 bg-slate-100 text-slate-600 h-14 rounded-[20px] font-bold hover:bg-slate-200 transition-all">
                    Volver al POS
                  </button>
                  <button onClick={handleSaveAndClose} className="flex-1 bg-[#1d1d1f] text-white h-14 rounded-[20px] font-bold shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex justify-center items-center gap-2">
                    <Printer size={20} /> Guardar e Imprimir Z
                  </button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* POS PRINCIPAL */}
      <div className="flex-1 flex flex-col p-8 overflow-hidden">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <img 
              src="https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg" 
              alt="Cariñito Mío" 
              className="h-16 w-auto object-contain rounded-xl shadow-sm"
            />
          </div>
          
          <div className="flex items-center gap-4">
            
            {/* 🟢 NUEVO: BUSCADOR DE TICKETS PARA REIMPRESIÓN */}
            <div className="flex items-center gap-1 bg-white rounded-[20px] border border-slate-200 p-1.5 shadow-sm">
               <div className="relative w-36">
                 <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                 <input 
                   type="number" 
                   placeholder="Ticket #" 
                   value={ticketSearchTerm} 
                   onChange={(e)=>setTicketSearchTerm(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && reprintHistoricalTicket(ticketSearchTerm)}
                   className="w-full bg-transparent py-2 pl-9 pr-2 outline-none text-sm font-bold text-slate-700" 
                 />
               </div>
               <button onClick={() => reprintHistoricalTicket(ticketSearchTerm)} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-[14px] text-slate-500 transition-colors">
                 <Search size={18} />
               </button>
               <div className="w-px h-6 bg-slate-200 mx-1"></div>
               <button onClick={() => reprintHistoricalTicket()} title="Reimprimir Último Ticket" className="p-2 bg-[#0071e3]/10 hover:bg-[#0071e3]/20 text-[#0071e3] rounded-[14px] transition-colors">
                 <Printer size={18} />
               </button>
            </div>

            <div className="relative w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="¿Qué se te antoja?" value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="w-full bg-white border border-slate-200 rounded-[20px] py-3.5 pl-12 pr-4 outline-none text-sm font-medium focus:ring-4 focus:ring-[#0071e3]/10 transition-all" />
            </div>
            
            <button onClick={handleOpenCierre} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 px-4 py-3.5 rounded-[20px] hover:bg-slate-50 hover:text-red-500 transition-all font-semibold text-sm shadow-sm">
              <LogOut size={18} /> Terminar Turno
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto space-y-12 pr-4 custom-scrollbar">
          {Object.keys(groupedProducts).sort().map(cat => (
            <section key={cat}>
              <h2 className="text-[11px] font-black uppercase text-slate-400 mb-5 px-2 tracking-[0.2em]">{cat}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {groupedProducts[cat].map((p: any) => (
                  <div key={p.id} onClick={() => handleProductClick(p)} className="bg-white rounded-[2.5rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-xl transition-all cursor-pointer group border border-transparent hover:border-blue-50">
                    <div className="h-32 bg-slate-50 rounded-[20px] mb-4 overflow-hidden relative">
                      {p.image_url && <img src={p.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt={p.name} />}
                    </div>
                    <h3 className="font-bold text-sm text-slate-800">{p.name}</h3>
                    <p className="text-[#0071e3] font-black text-sm mt-1">${Number(p.price).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* TICKET DERECHA */}
      <div className="w-[420px] bg-white border-l border-slate-100 flex flex-col shadow-2xl relative">
        <div className="p-8 pb-4 space-y-6 border-b border-slate-50">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold tracking-tight">Orden Actual</h2>
            <div className="p-2 bg-[#F5F5F7] rounded-full text-slate-400"><ShoppingBag size={18}/></div>
          </div>

          <div className="animate-in fade-in slide-in-from-top-2 duration-500">
            {!activeCustomer ? (
              <div className="flex gap-2 relative">
                <div className="relative flex-1 group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-[#0071e3] transition-colors" />
                  <input 
                    type="text" 
                    placeholder="Nombre, Código o WA" 
                    className="w-full bg-[#F5F5F7] border border-transparent rounded-xl py-3 pl-9 pr-4 text-[13px] font-medium outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all"
                    value={customerSearch}
                    onChange={(e) => handleCustomerSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchCustomer()}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    onFocus={() => customerSearch.length >= 2 && setShowSuggestions(true)}
                  />
                  
                  {showSuggestions && customerSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                      {customerSuggestions.map(c => (
                        <div 
                          key={c.id} 
                          onClick={() => selectCustomer(c)} 
                          className="p-3 hover:bg-[#0071e3]/5 cursor-pointer border-b border-slate-50 last:border-0 flex flex-col transition-colors"
                        >
                          <span className="font-bold text-sm text-slate-800">{c.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold">{c.customer_code}</span>
                            <span className="text-[10px] text-slate-400 font-medium">{c.phone}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <button onClick={() => setShowCustomerModal(true)} className="p-3 bg-[#0071e3] text-white rounded-xl shadow-lg shadow-blue-50 hover:scale-105 transition-all flex-shrink-0">
                  <UserPlus size={18}/>
                </button>
              </div>
            ) : (
              <div className="bg-[#1c1c1e] text-white p-5 rounded-[22px] flex justify-between items-center shadow-xl">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider">Miembro Mi Café</p>
                  <h4 className="font-semibold text-sm truncate w-40">{activeCustomer.name}</h4>
                  <p className="text-[11px] font-semibold text-[#0071e3]">{activeCustomer.points} pts acumulados</p>
                </div>
                <button onClick={() => setActiveCustomer(null)} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"><X size={14} /></button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 px-8 overflow-y-auto py-6 space-y-4">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-60 space-y-4">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center">
                <ShoppingBag size={32} strokeWidth={1.5} />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]">Carrito Vacío</p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="p-5 bg-[#F5F5F7]/80 rounded-[28px] border border-transparent hover:border-slate-200 transition-all space-y-4 group">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-semibold text-[#1d1d1f] text-[15px] tracking-tight">{item.product.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {item.product.displayExtras?.map((e: any) => (
                        <span key={e.name} className="text-[10px] bg-white text-[#0071e3] px-2 py-0.5 rounded-md font-semibold border border-slate-100 uppercase tracking-tighter">
                          {e.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="font-bold text-[#1d1d1f] text-[15px]">${(item.product.price * item.quantity).toFixed(2)}</p>
                </div>
                
                <div className="flex justify-between items-center pt-2">
                   <div className="flex items-center gap-4 bg-white rounded-xl px-3 py-1.5 shadow-sm border border-slate-100">
                      <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="p-1 hover:text-[#0071e3] text-slate-400 transition-colors"><Minus size={14}/></button>
                      <span className="font-bold text-[13px] w-5 text-center text-[#1d1d1f]">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="p-1 hover:text-[#0071e3] text-slate-400 transition-colors"><Plus size={14}/></button>
                   </div>
                   <div className="flex gap-2">
                      <button onClick={() => handleEditItem(item)} className="p-2.5 text-[#86868b] hover:text-[#0071e3] rounded-full transition-all"><Edit3 size={18}/></button>
                      <button onClick={() => removeItem(item.id)} className="p-2.5 text-[#86868b] hover:text-[#ff3b30] rounded-full transition-all"><Trash2 size={18}/></button>
                   </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-8 bg-white border-t border-slate-50 space-y-6">
          <div className="flex justify-between items-baseline">
            <span className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight">Total</span>
            <span className="text-4xl font-semibold text-[#1d1d1f] tracking-tighter">${getTotal().toFixed(2)}</span>
          </div>
          <button onClick={handleOpenCheckout} disabled={items.length === 0} className="w-full bg-[#0071e3] text-white h-16 rounded-[22px] font-semibold text-lg shadow-xl shadow-blue-100 hover:bg-[#0077ed] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none">
             <CreditCard size={22}/> Pagar Ahora
          </button>
        </div>
      </div>
      
      {/* 🟢 CHECKOUT DIVIDIDO EN 2 PASOS */}
      {showCheckoutModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-[500px] shadow-2xl p-8 animate-in zoom-in-95 duration-200">
             
             {/* HEADER CON BOTÓN DE REGRESAR */}
             <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  {checkoutStep === 2 && (
                    <button onClick={() => setCheckoutStep(1)} className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
                      <ChevronLeft size={20}/>
                    </button>
                  )}
                  <h3 className="text-2xl font-black italic tracking-tight text-slate-900">
                    {checkoutStep === 1 ? 'Detalles de Orden' : 'Finalizar Venta'}
                  </h3>
                </div>
                <button onClick={() => setShowCheckoutModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 transition-colors"><X size={20}/></button>
             </div>

             {/* 🟢 PASO 1: TIPO DE ORDEN Y NOTAS */}
             {checkoutStep === 1 && (
               <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                 <div className="mb-6 space-y-6">
                    <div>
                      <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-3">Tipo de Orden</label>
                      <div className="grid grid-cols-2 gap-3">
                        {['En Local', 'Para Llevar'].map(type => (
                           <button key={type} onClick={() => setOrderType(type)} className={`p-4 rounded-xl border-2 font-bold text-base transition-all ${orderType === type ? 'border-[#0071e3] text-[#0071e3] bg-blue-50/50 shadow-sm' : 'border-slate-100 text-slate-600 hover:border-blue-200 bg-white'}`}>
                              {type}
                            </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-3">Notas Adicionales</label>
                      <textarea 
                        value={orderNote}
                        onChange={e => setOrderNote(e.target.value)}
                        placeholder="Ej. Mesa 4, cobrar por separado, etc..."
                        className="w-full h-32 bg-[#f5f5f7] border-2 border-transparent focus:border-[#0071e3]/30 rounded-[16px] p-4 text-[15px] font-medium outline-none resize-none text-slate-700 transition-colors"
                      />
                    </div>
                 </div>
                 <button onClick={() => setCheckoutStep(2)} className="w-full bg-[#0071e3] text-white h-16 rounded-[20px] font-bold text-lg flex justify-center items-center gap-2 shadow-xl hover:bg-[#0077ed] active:scale-95 transition-all">
                    Continuar <ChevronRight size={22}/>
                 </button>
               </div>
             )}

             {/* 🟢 PASO 2: TOTALES Y MÉTODO DE PAGO */}
             {checkoutStep === 2 && (
               <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                 <div className="bg-[#f5f5f7] p-5 rounded-[20px] mb-6 flex flex-col gap-2 border border-slate-100">
                    <div className="flex justify-between items-end">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Total MXN</span>
                      <span className="text-4xl font-black tracking-tighter text-[#1d1d1f]">${getTotal().toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-end border-t border-slate-200 pt-3 mt-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Equivalente USD</span>
                      <span className="text-lg font-black text-slate-400">${parseAmount(exchangeRate) > 0 ? (getTotal() / parseAmount(exchangeRate)).toFixed(2) : '0.00'}</span>
                    </div>
                 </div>

                 <div className="mb-6">
                    <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-3">Método de Pago</label>
                    <div className="grid grid-cols-2 gap-3">
                      {['Efectivo', 'Mixto', 'Tarjeta', 'Otro'].map(method => (
                         <button key={method} onClick={() => {
                              setPaymentMethod(method);
                              if (method === 'Tarjeta' || method === 'Otro') { setAmountReceivedMXN(getTotal()); setAmountReceivedUSD(''); } 
                              else { setAmountReceivedMXN(''); setAmountReceivedUSD(''); }
                            }} className={`p-3.5 rounded-xl border-2 font-bold text-sm transition-all ${paymentMethod === method ? 'border-[#0071e3] text-[#0071e3] bg-blue-50/50' : 'border-slate-100 text-slate-600 hover:border-blue-200 bg-white'}`}>
                            {method}
                          </button>
                      ))}
                    </div>
                 </div>

                 <div className="space-y-3 mb-8">
                    <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest">Cantidades Recibidas</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">MXN</span>
                        <input type="number" disabled={paymentMethod === 'Tarjeta' || paymentMethod === 'Otro'} value={amountReceivedMXN} onChange={e => setAmountReceivedMXN(e.target.value)} placeholder="0.00" className="w-full bg-[#f5f5f7] border-2 border-transparent focus:border-[#0071e3]/30 rounded-[16px] py-3.5 pl-14 pr-3 text-lg font-black outline-none disabled:opacity-60 text-right"/>
                      </div>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">USD</span>
                        <input type="number" disabled={paymentMethod === 'Tarjeta' || paymentMethod === 'Otro'} value={amountReceivedUSD} onChange={e => setAmountReceivedUSD(e.target.value)} placeholder="0.00" className="w-full bg-[#f5f5f7] border-2 border-transparent focus:border-[#0071e3]/30 rounded-[16px] py-3.5 pl-14 pr-3 text-lg font-black outline-none disabled:opacity-60 text-right"/>
                      </div>
                    </div>
                    
                    {/* BLOQUE DE CAMBIO EN VERDE */}
                    {((paymentMethod === 'Efectivo' || paymentMethod === 'Mixto') && totalReceivedCombinedMXN >= getTotal()) && (
                      <div className="flex flex-col gap-2 bg-[#06c167]/10 p-4 rounded-xl mt-4 animate-in fade-in border border-[#06c167]/20">
                         <div className="flex justify-between items-center">
                           <span className="text-xs font-bold text-[#06c167] uppercase tracking-wider">Cambio (MXN):</span>
                           <span className="text-xl font-black text-[#06c167]">${(totalReceivedCombinedMXN - getTotal()).toFixed(2)}</span>
                         </div>
                      </div>
                    )}

                    {/* 🟢 NUEVO: BLOQUE DE FALTANTE EN COLOR VINO */}
                    {((paymentMethod === 'Efectivo' || paymentMethod === 'Mixto') && totalReceivedCombinedMXN < getTotal() && totalReceivedCombinedMXN > 0) && (
                      <div className="flex flex-col gap-2 bg-[#800020]/10 p-4 rounded-xl mt-4 animate-in fade-in border border-[#800020]/20">
                         <div className="flex justify-between items-center">
                           <span className="text-xs font-bold text-[#800020] uppercase tracking-wider">Falta cobrar (MXN):</span>
                           <span className="text-xl font-black text-[#800020]">${(getTotal() - totalReceivedCombinedMXN).toFixed(2)}</span>
                         </div>
                      </div>
                    )}
                 </div>

                 <button onClick={processCheckout} disabled={isProcessingCheckout || isPaymentInsufficient} className="w-full bg-[#1d1d1f] text-white h-16 rounded-[20px] font-bold text-lg flex justify-center items-center gap-2 shadow-xl hover:bg-black active:scale-95 transition-all">
                    {isProcessingCheckout ? <Loader2 className="animate-spin" /> : <><CheckCircle2 size={22}/> Confirmar Pago</>}
                 </button>
               </div>
             )}
          </div>
        </div>
      )}

      {showPostSaleModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-[#0071e3]/80 backdrop-blur-3xl" />
          
          <div className="relative bg-white/80 backdrop-blur-2xl rounded-[3rem] w-full max-w-[440px] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] p-12 text-center border border-white/40 animate-in zoom-in-95 duration-500">
             
             <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg shadow-green-500/20">
               <CheckCircle2 size={44} strokeWidth={1.5} />
             </div>

             <h2 className="text-[32px] font-semibold tracking-tight text-[#1d1d1f] mb-2">Venta Exitosa</h2>
             <p className="text-[#86868b] text-[17px] mb-10 font-medium leading-relaxed">
               La orden ha sido procesada.<br/>¿Deseas imprimir los comprobantes?
             </p>
             
             <div className="space-y-3 mb-10">
               <button onClick={() => handlePrint('sticker')} className="w-full flex items-center justify-center gap-3 bg-white/50 hover:bg-white/80 text-[#1d1d1f] h-[64px] rounded-2xl font-semibold text-[17px] transition-all border border-[#d2d2d7]/50 active:scale-[0.98]">
                 <Tag size={20} className="text-[#0071e3]"/> Imprimir Sticker
               </button>
               
               <button onClick={() => handlePrint('ticket')} className="w-full flex items-center justify-center gap-3 bg-white/50 hover:bg-white/80 text-[#1d1d1f] h-[64px] rounded-2xl font-semibold text-[17px] transition-all border border-[#d2d2d7]/50 active:scale-[0.98]">
                 <Printer size={20} className="text-[#0071e3]"/> Imprimir Ticket
               </button>
             </div>

             <button onClick={handleNextOrder} className="w-full bg-[#1d1d1f] hover:bg-[#000000] text-white h-[64px] rounded-2xl font-semibold text-[17px] shadow-xl shadow-black/10 active:scale-[0.98] transition-all">
               Finalizar y Nueva Venta
             </button>
             
             <div className="mt-8">
               <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-[0.2em]">Mi Café OS • 2026</span>
             </div>
          </div>
        </div>
      )}

      {/* WIZARD ACTUALIZADO */}
      {selectedProduct && dynamicSteps.length > 0 && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-[130] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="p-6 md:p-8 flex flex-col border-b border-slate-50 bg-white z-10">
              <div className="flex justify-between items-center mb-4">
                <div className="space-y-1">
                  <h3 className="text-2xl font-bold tracking-tight text-slate-800">{selectedProduct.name}</h3>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Paso {customizationStep + 1} de {dynamicSteps.length}</p>
                </div>
                <button onClick={() => {setSelectedProduct(null); setActiveExtras([]); setProductNote('');}} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors text-slate-500"><X size={20}/></button>
              </div>
              
              <div className="flex gap-2">
                {dynamicSteps.map((_, idx) => (
                  <div key={idx} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${idx <= customizationStep ? 'bg-[#0071e3]' : 'bg-slate-100'}`} />
                ))}
              </div>
            </div>
            
            <div className="flex-1 p-6 md:p-8 bg-[#F5F5F7]">
              <h4 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-white text-[#0071e3] flex items-center justify-center shadow-sm text-sm border border-slate-100">{customizationStep + 1}</span>
                {dynamicSteps[customizationStep].title}
              </h4>

              {dynamicSteps[customizationStep].id === 'notes' ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <textarea 
                    className="w-full bg-white border border-slate-200 focus:border-[#0071e3]/40 rounded-2xl p-4 text-[15px] font-medium outline-none transition-all resize-none h-32 text-slate-700 shadow-sm"
                    placeholder="Ej. Extra caliente, sin espuma, en taza de vidrio..."
                    value={productNote}
                    onChange={(e) => setProductNote(e.target.value)}
                    autoFocus
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-right-4 duration-300">
                  {dynamicSteps[customizationStep].options.map((optName: string) => {
                    const sel = activeExtras.some(e => e.name === optName);
                    const dbExtra = dbExtras.find(e => e.name.toLowerCase() === optName.toLowerCase());
                    const extraPrice = dbExtra ? Number(dbExtra.price) : 0;
                    const stepConfig = dynamicSteps[customizationStep];

                    return (
                      <button 
                        key={optName} 
                        onClick={() => {
                          let newExtras = [...activeExtras];
                          const isSelected = newExtras.find(e => e.name === optName);
                          if (isSelected) { newExtras = newExtras.filter(e => e.name !== optName); } 
                          else { if (stepConfig.exclusive) { newExtras = newExtras.filter(e => !stepConfig.options.includes(e.name)); } newExtras.push({ name: optName, price: extraPrice }); }
                          setActiveExtras(newExtras);

                          if (!isSelected && stepConfig.exclusive) {
                            setTimeout(() => {
                              setCustomizationStep(prev => Math.min(prev + 1, lastStepIndex));
                            }, 250); 
                          }
                        }} 
                        className={`p-4 rounded-2xl border-2 transition-all text-left flex justify-between items-center ${sel ? 'border-[#0071e3] bg-[#0071e3]/5 shadow-sm' : 'border-transparent bg-white shadow-sm hover:border-blue-200'}`}
                      >
                        <span className={`font-bold text-[15px] ${sel ? 'text-[#0071e3]' : 'text-slate-700'}`}>{optName}</span>
                        {extraPrice > 0 && <span className={`text-xs font-black px-2 py-1 rounded-md ${sel ? 'bg-[#0071e3]/10 text-[#0071e3]' : 'bg-slate-100 text-slate-400'}`}>+${extraPrice}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="p-6 md:p-8 bg-white border-t border-slate-50 flex gap-4">
              <button 
                onClick={() => setCustomizationStep(prev => prev - 1)} 
                disabled={customizationStep === 0}
                className="w-14 h-14 flex-shrink-0 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-50 disabled:hover:bg-slate-100 transition-colors"
              >
                <ChevronLeft size={24} />
              </button>
              
              {customizationStep < lastStepIndex ? (
                <button 
                  onClick={() => setCustomizationStep(prev => prev + 1)} 
                  className="flex-1 bg-[#0071e3] text-white h-14 rounded-2xl font-bold text-lg hover:bg-[#0077ed] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  Siguiente <ChevronRight size={20} />
                </button>
              ) : (
                <button 
                  onClick={handleConfirmAdd} 
                  className="flex-1 bg-[#1d1d1f] text-white h-14 rounded-2xl font-bold text-lg hover:bg-black active:scale-[0.98] transition-all shadow-xl"
                >
                  Confirmar Producto
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showCustomerModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6 text-slate-900">
              <h3 className="text-2xl font-black italic tracking-tight">Nuevo Miembro</h3>
              <button onClick={() => setShowCustomerModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-400"><X size={20}/></button>
            </div>
            <form onSubmit={handleRegisterCustomer} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" required placeholder="Nombre" className="p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.firstName} onChange={e => setCustomerForm({...customerForm, firstName: e.target.value})} />
                <input type="text" required placeholder="Apellido" className="p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.lastName} onChange={e => setCustomerForm({...customerForm, lastName: e.target.value})} />
              </div>
              <input type="date" required className="w-full p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.birthDate} onChange={e => setCustomerForm({...customerForm, birthDate: e.target.value})} />
              <input type="tel" required placeholder="WhatsApp" className="w-full p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.whatsapp} onChange={e => setCustomerForm({...customerForm, whatsapp: e.target.value})} />
              <button type="submit" disabled={isRegistering} className="w-full bg-[#0071e3] text-white py-4 rounded-2xl font-bold flex justify-center items-center gap-2">
                {isRegistering ? <Loader2 className="animate-spin" /> : 'Registrar Cliente'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function ArrowRight({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}