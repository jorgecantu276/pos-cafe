'use client';

import Image from 'next/image';
import ProductPhoto from '@/components/ProductPhoto';
import DrawerGate from './DrawerGate';
import { loadDrawerStatus, recoverDrawerRequest, beginDrawerHandoff, enrollCustomer, hasDrawerRequest, type DrawerStatus } from '@/lib/drawer';
import PrototypeRegister, {PrototypeCheckout, PrototypeCustomization} from './PrototypeRegister';
import './prototype.css';
import WorkspaceRegister, { WorkspaceCheckout, WorkspaceCustomization, WorkspaceOpening, WorkspaceDialog } from './WorkspaceRegister';
import './workspace.css';

import { catalogProduct, type CatalogProduct, type Customer, type ExtraRow, type WizardStep, errorMessage } from '@/lib/pos-types';

import { useCallback, useEffect, useRef, useState } from 'react';
import { customizeProduct, useCartStore, type CartExtra, type CartItem, type Product } from '@/store/useCartStore';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { useRouter } from 'next/navigation';
import { escapeHtml, openPrintWindow, writePrintDocument } from '@/lib/printing';
import PrintDispatch from './PrintDispatch';
import { printHistoricalReceipt } from '@/lib/receipt-reprint';
import './printing.css';
import { rememberSalePrint } from '@/lib/sale-printing';
import { saveShiftBeforeExit, type ShiftReport } from '@/lib/shift';
import { closeShift, expenseRequestKey, loadShiftSummary, recoverPendingExpenses, recoverShiftClose, restoreShiftExpenses, saveShiftExpenses, type ShiftSummary } from '@/lib/shift-state';
import { CheckoutRejected, checkoutPayload, executeCheckout, readCheckoutReview, withCheckoutLock, type CheckoutReview, type SavedOrder } from '@/lib/checkout';
import { bindCartDraft, cartDraftKey, type CartDraftBinding } from '@/lib/cart-draft';
import { withDeadline } from '@/lib/request-deadline';
import {
  Coffee, Minus, Plus, Trash2, CreditCard, ShoppingBag,
  Loader2, Search, X, UserPlus, Edit3, LogOut, Wallet,
  DollarSign, CheckCircle2, Printer, ChevronRight, ChevronLeft, Receipt
} from 'lucide-react';

// DENOMINACIONES DE DINERO
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50];

export default function POSPage({appearance='workspace'}:{appearance?:'owner'|'prototype'|'workspace'}={}) {
  const { items, addItem, removeItem, replaceItem, updateQuantity, getTotal, clearCart,
    orderType, orderNote, customerId, setOrderType, setOrderNote, setCustomerId } = useCartStore();
  const router = useRouter();
  const cartDraft = useRef<CartDraftBinding | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [customerRestoring, setCustomerRestoring] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const draftStorageKey = useRef('');
  const draftOwner = useRef('');
  const [checkoutReview, setCheckoutReview] = useState<CheckoutReview | null>(null);
  const checkoutReviewKey = useRef('');
  const [printCheckoutKey, setPrintCheckoutKey] = useState('');
  const [sessionActor, setSessionActor] = useState<string | null>(null);


  // 🟢 FUNCIÓN ROBUSTA PARA PARSEAR DINERO (Evita errores de NaN y comas decimales)
  const parseAmount = (val: unknown) => {
    if (val === '' || val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const parsed = Number(String(val).replace(/,/g, '.'));
    return isNaN(parsed) ? 0 : parsed;
  };

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [dbExtras, setDbExtras] = useState<ExtraRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketSearchTerm, setTicketSearchTerm] = useState(''); // 🟢 ESTADO PARA BUSCAR TICKET
  const [userName, setUserName] = useState('Barista');
  const [isAdmin,setIsAdmin]=useState(false);
  const [drawer, setDrawer] = useState<DrawerStatus | null>(null);
  const [drawerActor, setDrawerActor] = useState('');
  const [closeAction, setCloseAction] = useState<'close'|'handoff'>('close');
  const [handoffTarget, setHandoffTarget] = useState('');

  // ESTADOS DE TURNO
  const [registerId, setRegisterId] = useState('');
  const [openingShift, setOpeningShift] = useState(false);
  const openingInFlight = useRef(false);
  const shiftMemoryKey = useRef('');
  const [savedSale, setSavedSale] = useState<SavedOrder | null>(null);
  const closedShiftReport = useRef<ShiftReport | null>(null);
  const [showApertura, setShowApertura] = useState(false);
  const [showCierre, setShowCierre] = useState(false);
  const [cashSales, setCashSales] = useState(0);
  const [isClosingShift, setIsClosingShift] = useState(false);
  const closingShift = useRef(false);
  const shiftSaved = useRef(false);
  const shiftSummary = useRef<ShiftSummary | null>(null);
  const expenseInFlight = useRef(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);

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
  const checkoutInFlight = useRef(false);

  // ESTADOS PARA AUTOCOMPLETADO DE CLIENTES
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ESTADOS PARA IMPRESIÓN Y PERSONALIZACIÓN
  const [showPostSaleModal, setShowPostSaleModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeExtras, setActiveExtras] = useState<CartExtra[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [productNote, setProductNote] = useState('');
  const [customizationStep, setCustomizationStep] = useState(0);

  // WIZARD DINÁMICO
  const [dynamicSteps, setDynamicSteps] = useState<WizardStep[]>([]);
  const lastStepIndex = dynamicSteps.length > 0 ? dynamicSteps.length - 1 : 0;

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (cartDraft.current && (event.key === null || event.key === cartDraft.current.key)) {
        try { cartDraft.current.checkCurrent(); } catch (error) { setDraftError(errorMessage(error)); }
      }
    };
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const actor = session?.user.id ?? '';
      setSessionActor(actor); // Revalidate identity/catalog outside the Auth callback.
      if (!draftOwner.current || actor === draftOwner.current) return;
      cartDraft.current?.disconnect(); cartDraft.current = null;
      draftOwner.current = ''; checkoutReviewKey.current = '';
      setPrintCheckoutKey('');
      checkoutInFlight.current = false;
      shiftSummary.current = null;
      setExpenses([]); setShowCierre(false); setExpenseError(null); setSavingExpense(false); setIsClosingShift(false);
      shiftSaved.current = false; closedShiftReport.current = null;
      useCartStore.getState().clearCart(); setActiveCustomer(null); setCheckoutReview(null);
      setIsProcessingCheckout(false); setShowCheckoutModal(false); setShowPostSaleModal(false); setSelectedProduct(null); setSavedSale(null);
      setProducts([]); setDbExtras([]); setDraftError(null); setCustomerError(null);
      router.replace('/login'); router.refresh();
    });
    window.addEventListener('storage', changed);
    return () => {
      authListener.subscription.unsubscribe();
      window.removeEventListener('storage', changed);
      cartDraft.current?.disconnect(); cartDraft.current = null;
      draftOwner.current = ''; checkoutReviewKey.current = '';
      useCartStore.getState().clearCart();
    };
  }, [router]);

  const loadPOS = useCallback(async (signal: AbortSignal) => {
    const { data: { user }, error: authError } = await withDeadline(() => supabase.auth.getUser(), { signal });
    if (authError) throw authError;
    if (!user) return null;
    if (sessionActor !== null && user.id !== sessionActor) throw new Error('La sesión está cambiando. Reintenta la conexión.');
    const profile = await supabase.from('profiles').select('full_name,role,is_active').eq('id',user.id).abortSignal(signal).single();
    if (profile.error || !profile.data?.is_active || !['admin','cashier','barista'].includes(profile.data.role)) throw new Error('Tu perfil no tiene acceso o falta actualizar la base de datos.');
    await recoverPendingExpenses(supabase, localStorage, user.id);
    await recoverShiftClose(supabase, localStorage, user.id);
    await recoverDrawerRequest(supabase, localStorage, user.id, 'handoff');
    await recoverDrawerRequest(supabase, localStorage, user.id, 'accept');
    const drawer = await loadDrawerStatus(supabase, signal);
    const [catalog, extras, shift] = await Promise.all([
      supabase.from('products').select('*').order('name').abortSignal(signal),
      supabase.from('extras').select('*').order('phase').abortSignal(signal),
      supabase.from('cash_registers').select('id,opened_at,initial_balance,exchange_rate').eq('opened_by',user.id).eq('status','open').abortSignal(signal).maybeSingle(),
    ]);
    for (const result of [catalog, extras, shift]) if (result.error) throw result.error;
    if (shift.data && !shift.data.exchange_rate) throw new Error('El turno anterior requiere conciliación antes de usar esta versión.');
    const summary = shift.data ? await restoreShiftExpenses(supabase, localStorage, user.id, shift.data.id, signal) : null;
    return { user, drawer, profile:profile.data, products:(catalog.data || []).map(catalogProduct), extras:(extras.data || []) as ExtraRow[], shift:shift.data, summary };
  }, [sessionActor]);
  const applyPOS = useCallback((data: Awaited<ReturnType<typeof loadPOS>> | null) => {
    if (!data) { router.replace('/login'); return; }
    setUserName(data.profile.full_name);
    setIsAdmin(data.profile.role==='admin');
    setDrawer(data.drawer);
    setDrawerActor(data.user.id);
    draftOwner.current = data.user.id;
    checkoutReviewKey.current = `mi_cafe_checkout_review:${data.user.id}`;
    setPrintCheckoutKey(`mi_cafe_checkout_review:${data.user.id}`);
    shiftMemoryKey.current = `mi_cafe_shift:${data.user.id}`;
    shiftSaved.current = false; closedShiftReport.current = null;
    shiftSummary.current = data.summary; setExpenseError(null);
    draftStorageKey.current = cartDraftKey(data.user.id);
    try { setCheckoutReview(readCheckoutReview(localStorage.getItem(checkoutReviewKey.current))); }
    catch { setCheckoutReview({ startedAt:'Registro pendiente ilegible', total:0 }); }
    setProducts(data.products);
    setDbExtras(data.extras);
    cartDraft.current?.disconnect(); cartDraft.current = null;
    useCartStore.getState().clearCart();
    setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null); setDraftError(null);
    if (data.shift) {
      try {
        const binding = bindCartDraft({ storage: localStorage, userId: data.user.id, registerId: data.shift.id,
          products: data.products, extras: data.extras, onError: setDraftError,
          onRepriced: () => alert('Se actualizaron los precios del borrador con el catálogo actual. Revisa el total antes de cobrar.') });
        cartDraft.current = binding;
        if (binding.customerId) {
          setCustomerRestoring(true);
          void supabase.from('customers').select('*').eq('id', binding.customerId).abortSignal(AbortSignal.timeout(12_000)).maybeSingle().then(({ data: customer, error }) => {
            if (cartDraft.current !== binding || useCartStore.getState().customerId !== binding.customerId) return;
            setCustomerRestoring(false);
            if (error || !customer) setCustomerError('No se pudo recuperar el cliente del borrador. Reintenta la conexión o selecciona el cliente antes de cobrar.');
            else setActiveCustomer(customer);
          });
        }
      } catch (error) { setDraftError(errorMessage(error)); }
    }
    if (data.shift) {
      const shift = data.shift;
      setRegisterId(shift.id); setShiftStartTime(shift.opened_at); setStartingCash(Number(shift.initial_balance));
      setExchangeRate(String(shift.exchange_rate));
      setExpenses(data.summary!.expenses); setCashSales(data.summary!.cash_sales);
      setShowApertura(false);
    } else { setRegisterId(''); setExpenses([]); setCashSales(0); setExchangeRate(data.drawer.rate ? String(data.drawer.rate) : ''); setShowApertura(true); }
  }, [router]);
  const { loading, error: loadError, reload: fetchData } = useResource(loadPOS, null, applyPOS);

  const calculateTotalCash = () => {
    const pesos = Object.entries(breakdown).reduce((sum, [den, qty]) => sum + (Number(den) * qty), 0);
    const dollarsToPesos = parseAmount(dollarsInBox) * parseAmount(exchangeRate);
    return pesos + dollarsToPesos;
  };

  const handleStartShift = async () => {
    if (openingInFlight.current || loading || loadError) return;
    if (!exchangeRate || !Number.isFinite(parseAmount(exchangeRate)) || parseAmount(exchangeRate) <= 0
      || parseAmount(exchangeRate)>1000 || Math.round(parseAmount(exchangeRate)*10000)/10000 !== parseAmount(exchangeRate)
      || !Number.isFinite(calculateTotalCash()) || calculateTotalCash()<0 || calculateTotalCash()>10000000
      || Object.values(breakdown).some(q=>!Number.isInteger(q)||q<0) || parseAmount(dollarsInBox)<0) {
      alert("Por favor, introduce un Tipo de Cambio válido.");
      return;
    }

    openingInFlight.current = true;
    setOpeningShift(true);
    try {
      const openingKey = `${shiftMemoryKey.current}:opening`;
      let pending = JSON.parse(localStorage.getItem(openingKey) || 'null');
      if (!pending) {
        pending = { p_request: crypto.randomUUID(), p_cash: Math.round(calculateTotalCash()*100)/100, p_rate: parseAmount(exchangeRate) };
        localStorage.setItem(openingKey, JSON.stringify(pending));
      }
      const { data, error } = await supabase.rpc('pos_open_shift', pending);
      if (error) throw error;
      if (!data?.id) throw new Error('No se recibió la apertura. Reintenta la misma solicitud.');
      if (data.status !== 'open') { localStorage.removeItem(openingKey); await fetchData(); return; }
      localStorage.removeItem(openingKey);
      localStorage.setItem(shiftMemoryKey.current, JSON.stringify({ registerId: data.id, expenses: [] }));
      setRegisterId(data.id);
      setStartingCash(Number(data.initial_balance));
      setExchangeRate(String(data.exchange_rate));
      setShiftStartTime(data.opened_at);
      setBreakdown(DENOMINATIONS.reduce((acc, den) => ({ ...acc, [den]: 0 }), {}));
      setDollarsInBox('');
      setShowApertura(false);
      await fetchData();
    } catch (error) {
      if (error && typeof error==='object' && 'code' in error && /^[0-9A-Z]{5}$/.test(String(error.code))) {
        localStorage.removeItem(`${shiftMemoryKey.current}:opening`);
        alert('La apertura fue rechazada sin guardar cambios. Revisa los importes y recupera cualquier turno abierto.');
        await fetchData();
        return;
      }
      alert('No se confirmó la apertura. Se conserva la misma solicitud para recuperarla. ' + (error instanceof Error ? errorMessage(error) : 'Revisa la conexión.'));
    } finally { openingInFlight.current = false; setOpeningShift(false); }
  };

  const updateExpenses = async (updated: {desc:string;amount:number}[]) => {
    if (expenseInFlight.current || closingShift.current || shiftSaved.current || !shiftSummary.current) return false;
    const owner = draftOwner.current, summary = shiftSummary.current;
    expenseInFlight.current = true; setSavingExpense(true); setExpenseError(null);
    try {
      const next = await saveShiftExpenses(supabase, localStorage, owner, summary, updated);
      if (draftOwner.current !== owner || shiftSummary.current?.register_id !== summary.register_id) return false;
      shiftSummary.current = next; setExpenses(next.expenses); setCashSales(next.cash_sales);
      return true;
    } catch (failure) {
      if (draftOwner.current === owner) setExpenseError('No se confirmó el gasto. Reintenta la conexión para recuperar la misma solicitud. ' + errorMessage(failure));
      return false;
    } finally { expenseInFlight.current = false; if (draftOwner.current === owner) setSavingExpense(false); }
  };
  const handleAddExpense = async () => {
    if (!newExpense.desc.trim() || !Number.isFinite(Number(newExpense.amount)) || Number(newExpense.amount) <= 0) return;
    if (await updateExpenses([...expenses, {desc:newExpense.desc.trim(),amount:Number(newExpense.amount)}])) setNewExpense({desc:'',amount:''});
  };
  const handleRemoveExpense = async (index: number) => {
    await updateExpenses(expenses.filter((_, i) => i !== index));
  };

  const handleOpenCierre = async (action: 'close'|'handoff' = 'close') => {
    if (!registerId || checkoutReview || checkoutInFlight.current) { alert('Resuelve la venta pendiente antes de cerrar el turno.'); return; }

    if (expenseInFlight.current || expenseError) { alert('Recupera los gastos antes de abrir el corte.'); return; }
    if (action === 'handoff' && items.length) { alert('Termina o vacía la orden actual antes de entregar la caja.'); return; }
    const owner = draftOwner.current;
    try {
      const summary = await loadShiftSummary(supabase, registerId);
      if (draftOwner.current !== owner || summary.status !== 'open') return;
      if (localStorage.getItem(expenseRequestKey(owner))) throw new Error('Hay un gasto pendiente de recuperar.');
      shiftSummary.current = summary; setExpenses(summary.expenses); setCashSales(summary.cash_sales);
      setCloseAction(action); setHandoffTarget('');
      setBreakdown(DENOMINATIONS.reduce((acc, den) => ({ ...acc, [den]: 0 }), {})); setDollarsInBox('');
      setShowCierre(true);
    } catch (failure) { alert('No se pudo consultar el corte. El turno sigue abierto. ' + errorMessage(failure)); }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      cartDraft.current?.disconnect(); cartDraft.current = null;
      clearCart();
      router.replace('/login');
      router.refresh();
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      alert('No se pudo cerrar la sesión. El corte guardado no se volverá a registrar.');
    }
  };

  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const expectedCash = Math.round((startingCash + cashSales - totalExpenses) * 100) / 100;
  const countedCash = calculateTotalCash();
  const difference = countedCash - expectedCash;

  // 🟢 NUEVA FUNCIÓN: REPORTE DE CORTE Z
  const printZReport = (target: Window, report: ShiftReport) => {
    const startingCash = Number(report.starting_cash);
    const todaysSales = Number(report.total_sales);
    const cashSales = Number(report.expected_cash) - startingCash + Number(report.total_expenses);
    const totalExpenses = Number(report.total_expenses);
    const expectedCash = Number(report.expected_cash);
    const countedCash = Number(report.counted_cash);
    const difference = Number(report.difference);
    const expenses = report.expenses_detail;
    const printWindow = target ?? openPrintWindow();
    if (!printWindow) return;

    const endDate = new Date();
    const startDate = shiftStartTime ? new Date(shiftStartTime) : endDate;

    const formatTime = (d: Date) => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
    const formatDate = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const content = `
      <div style="width: 72mm; font-family: 'Helvetica', 'Arial', sans-serif; color: #000; padding: 10px; margin: 0 auto; line-height: 1.4;">

        <div style="text-align: center; margin-bottom: 15px;">
          <img src="https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg" style="width: 180px; margin-bottom: 10px;">
          <h1 style="font-size: 20px; margin: 0; font-weight: 900; text-transform: uppercase;">Corte de Caja (Z)</h1>
          <p style="font-size: 11px; margin: 5px 0;">Cariñito Mío - Matamoros</p>
        </div>

        <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>

        <div style="font-size: 12px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between;">
            <span><b>Fecha:</b> ${formatDate(endDate)}</span>
            <span><b>Cajero:</b> ${escapeHtml(userName)}</span>
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
            <span>Ventas totales (referencia):</span>
            <span>$${todaysSales.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
            <span>(+) Ventas en efectivo:</span>
            <span>$${cashSales.toFixed(2)}</span>
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
                <span style="flex: 1; padding-right: 10px; word-break: break-all;">${escapeHtml(e.desc)}</span>
                <span>$${e.amount.toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 35px;">
          <p style="font-size: 11px; margin-bottom: 25px;">Firma del Cajero</p>
          <div style="border-bottom: 1px solid #000; width: 80%; margin: 0 auto 5px auto;"></div>
          <p style="font-size: 11px; font-weight: bold;">${escapeHtml(userName)}</p>
          <p style="font-size: 9px; margin-top: 15px; color: #666; line-height: 1.2;">
            Documento de control interno.<br>Mi Café OS • 2026
          </p>
        </div>

      </div>
    `;

    writePrintDocument(printWindow, content, 'receipt', `Corte Z - ${userName}`);
  };

const handleSaveAndClose = async () => {
    if (closingShift.current || expenseInFlight.current || expenseError || !shiftSummary.current) return;
    if (!Number.isFinite(countedCash) || countedCash<0 || countedCash>10000000 || Object.values(breakdown).some(q=>!Number.isInteger(q)||q<0)
      || !Number.isFinite(parseAmount(dollarsInBox)) || parseAmount(dollarsInBox)<0 || Math.round(parseAmount(dollarsInBox)*100)/100!==parseAmount(dollarsInBox)) {
      alert('Revisa el conteo: piezas enteras y dólares con máximo dos decimales, sin cantidades negativas.');return;
    }
    if(closeAction==='handoff'&&(!handoffTarget||items.length)){alert('Selecciona al siguiente cajero y termina o vacía la orden actual.');return;}
    const summary = shiftSummary.current, owner = draftOwner.current;
    closingShift.current = true;
    setIsClosingShift(true);
    // Reserve the popup during the user click; do not print an unsaved close.
    const printWindow = openPrintWindow();
    try {
      await saveShiftBeforeExit(async () => {
        if (shiftSaved.current) return { error: null };
        const report = closeAction === 'handoff' ? await beginDrawerHandoff(supabase, localStorage, owner, summary, countedCash, handoffTarget) : await closeShift(supabase, localStorage, owner, summary, countedCash);
        if (draftOwner.current !== owner) throw new Error('El corte se guardó para la sesión anterior.');
        shiftSaved.current = true; closedShiftReport.current = report;
        return {error:null};
      }, async () => {
        try { if (printWindow && closedShiftReport.current) printZReport(printWindow, closedShiftReport.current); }
        catch { printWindow?.close(); alert('El corte se guardó, pero no se pudo abrir la impresión.'); }
        await handleLogout();
      });
    } catch (error) {
      printWindow?.close();
      alert('No se confirmó el guardado del corte. Conservamos el turno. Revisa el historial antes de intentar nuevamente. ' + (error instanceof Error ? errorMessage(error) : ''));
    } finally {
      closingShift.current = false;
      if (draftOwner.current === owner) setIsClosingShift(false);
    }
  };

  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const registeringCustomer = useRef(false);
  const [customerRegisterError, setCustomerRegisterError] = useState('');
  const [customerForm, setCustomerForm] = useState({ firstName: '', lastName: '', birthDate: '', whatsapp: '', acceptPromos: false });
  const handleOpenCustomerModal = () => {
    try { setCustomerRegisterError(hasDrawerRequest(localStorage,draftOwner.current,'customer') ? 'Hay un alta sin confirmar. Reintentar recupera los datos originales y evita duplicar al cliente.' : ''); }
    catch(error) { setCustomerRegisterError(errorMessage(error)); }
    setShowCustomerModal(true);
  };

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

  const selectCustomer = (customer: Customer) => {
    setCustomerId(customer.id);
    setCustomerRestoring(false);
    setCustomerError(null);
    setActiveCustomer(customer);
    setCustomerSearch('');
    setCustomerSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSearchCustomer = async () => {
    if (!customerSearch) return;
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or(`customer_code.eq.${customerSearch.toUpperCase()},phone.eq.${customerSearch},name.ilike.%${customerSearch}%`)
        .limit(1)
        .single();

      if (error) throw new Error('No encontrado');
      selectCustomer(data);
    } catch { alert('Cliente no encontrado'); }
    finally { setShowSuggestions(false); }
  };

  const handleRegisterCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registeringCustomer.current) return;
    registeringCustomer.current = true; setCustomerRegisterError('');
    setIsRegistering(true);
    try {
      const actor = draftOwner.current;
      const customer = await enrollCustomer(supabase, localStorage, actor, {
        name: `${customerForm.firstName} ${customerForm.lastName}`.trim(), birthday: customerForm.birthDate || null,
        phone: customerForm.whatsapp, promos: customerForm.acceptPromos,
      });
      if (draftOwner.current !== actor) return;
      selectCustomer(customer);
      setShowCustomerModal(false);
      setCustomerForm({ firstName: '', lastName: '', birthDate: '', whatsapp: '', acceptPromos: false });
    } catch (error: unknown) { setCustomerRegisterError(errorMessage(error)); }
    finally { registeringCustomer.current = false; setIsRegistering(false); }
  };

  const buildWizardSteps = useCallback((product: Product): WizardStep[] => {
    if (!product.customizable || !product.wizard_steps || product.wizard_steps.length === 0) {
       return [];
    }
    const steps = product.wizard_steps.map((phaseName: string) => {
       const phaseOptions = dbExtras.filter(e => e.phase === phaseName && e.active).map(e => e.name);
       return {
          id: phaseName,
          title: `Seleccionar ${phaseName}`,
          options: phaseOptions,
          exclusive: ['Tamaño', 'Tipo de Leche','Leche alternativa'].includes(phaseName)
       };
    }).filter((step) => step.options.length > 0);
    return steps.length ? [...steps,{id:'notes',title:'Notas',options:[],exclusive:false}] : steps;
  }, [dbExtras]);

  const handleProductClick = useCallback((product: Product) => {
    if (!cartDraft.current || draftError || loading || loadError) return;
    setEditingItemId(null);
    const steps = buildWizardSteps(product);

    if (steps.length === 0) {
      addItem({ ...product, price: Number(product.price), basePrice: Number(product.price), displayExtras: [], note: '' });
    } else {
      setSelectedProduct(product);
      setActiveExtras([]);
      setProductNote('');
      setDynamicSteps(steps);
      setCustomizationStep(0);
    }
  }, [draftError, loading, loadError, addItem, buildWizardSteps]);

  const handleEditItem = (item: CartItem) => {
    const configured = buildWizardSteps(item.product);
    const steps = configured.length ? configured : [{id:'notes',title:'Notas',options:[],exclusive:false}];

    setSelectedProduct(item.product);
    setActiveExtras(item.product.displayExtras || []);
    setProductNote(item.product.note || '');
    setEditingItemId(item.id);
    setDynamicSteps(steps);
    setCustomizationStep(0);
  };

  const handleConfirmAdd = () => {
    if (!selectedProduct) return;
    const productWithExtras = customizeProduct(selectedProduct, activeExtras, productNote);
    if (editingItemId) replaceItem(editingItemId, productWithExtras);
    else addItem(productWithExtras);
    setEditingItemId(null);
    setSelectedProduct(null);
    setActiveExtras([]);
    setProductNote('');
  };

  const handleOpenCheckout = () => {
    if (loading || loadError || draftError || customerError || customerRestoring || closingShift.current || shiftSaved.current) return;
    if (checkoutReview || checkoutInFlight.current) {
      alert('Revisa la venta pendiente antes de iniciar otro cobro.');
      return;
    }
    if (items.length === 0) return;
    setPaymentMethod('Efectivo');
    setAmountReceivedMXN('');
    setAmountReceivedUSD('');
    setCheckoutStep(1);
    setShowCheckoutModal(true);
  };

  // 🟢 NUEVA FUNCIÓN: REIMPRIMIR HISTÓRICO (Por ID o Último)
  const reprintHistoricalTicket = async (ticketNum?: string) => {
    const target = openPrintWindow();
    if (!target) return;
    try {
      await printHistoricalReceipt(target, ticketNum ? { ticketNumber: ticketNum.replace(/^0+(?=\d)/, '') } : {});
      setTicketSearchTerm('');
    } catch (error) { alert('Error: ' + errorMessage(error)); }
  };

  const processCheckout = async () => {
    if (checkoutInFlight.current) return;
    const checkoutKey = checkoutReviewKey.current, binding = cartDraft.current;
    const stillCurrent = () => checkoutKey === checkoutReviewKey.current && binding === cartDraft.current;
    checkoutInFlight.current = true;
    let wasRecovery = true;
    let writtenReview: string | null = null;
    try {
      if (!checkoutKey) throw new Error('Espera a que termine de cargar tu sesión.');
      await withCheckoutLock(checkoutKey, async () => {
        if (!stillCurrent()) return;
        const existing = readCheckoutReview(localStorage.getItem(checkoutKey));
        wasRecovery = Boolean(existing);
        if (!navigator.onLine) throw new Error('Sin conexión. La venta no se envió; conserva la orden e intenta cuando vuelva internet.');
        setIsProcessingCheckout(true);

        let review = existing;
        if (!review) {
          if (!binding || draftError || customerRestoring || (customerId && activeCustomer?.id !== customerId))
            throw new Error('Revisa la recuperación del borrador y su cliente antes de cobrar.');
          const orderTotal = getTotal();
          if (!registerId || !items.length || !Number.isFinite(orderTotal) || orderTotal <= 0 || isPaymentInsufficient) throw new Error('Revisa la orden, el turno y el importe recibido.');
          const cash = ['Efectivo','Mixto'].includes(paymentMethod);
          review = { startedAt: new Date().toISOString(), total: orderTotal, requestId: binding.requestId(),
            payload: checkoutPayload(items, {
              register_id: registerId, expected_total: orderTotal, payment_method: paymentMethod.toLowerCase(),
              tender_mxn: cash ? parseAmount(amountReceivedMXN) : 0, tender_usd: cash ? parseAmount(amountReceivedUSD) : 0,
              customer_id: activeCustomer?.id || null, order_type: orderType, order_note: orderNote,
            }),
          };
          // Persist the exact identity and payload before the first request.
          writtenReview = JSON.stringify(review);
          localStorage.setItem(checkoutKey, writtenReview);
        }
        setCheckoutReview(review);
        const order = await executeCheckout(supabase, review);
        if (order.status === 'cancelled') {
          binding?.complete();
          localStorage.removeItem(checkoutKey);
          if (!stillCurrent()) return;
          setCheckoutReview(null); clearCart(); setShowCheckoutModal(false);
          alert('La venta fue cancelada por el responsable. No vuelvas a cobrarla; revisa cualquier devolución de dinero.');
          return;
        }
        if (order.status !== 'completed') throw new Error('El estado de esta venta requiere revisión del responsable.');
        // Save the print intent before retiring checkout recovery. Retrying uses the same sale.
        rememberSalePrint(localStorage, checkoutKey, order);
        binding?.complete(); // Retire only the original cashier's unpaid record.
        localStorage.removeItem(checkoutKey);
        if (!stillCurrent()) return;
        setSavedSale(order);
        setCheckoutReview(null);
        setLastOrderId(String(order.ticket_number).padStart(4, '0'));
        setShowCheckoutModal(false);
        setShowPostSaleModal(true);
      });

    } catch (error: unknown) {
      if (!wasRecovery && error instanceof CheckoutRejected && localStorage.getItem(checkoutKey) === writtenReview) {
        localStorage.removeItem(checkoutKey);
        if (stillCurrent()) setCheckoutReview(null);
      }
      if (!stillCurrent()) return;
      let needsReview = false;
      try { needsReview = Boolean(checkoutKey && localStorage.getItem(checkoutKey)); }
      catch { /* Storage failure must not hide the original save error. */ }
      if (needsReview) setShowCheckoutModal(false);
      alert((error instanceof Error ? errorMessage(error) : 'No se confirmó la venta.') + (needsReview ? '\nNo vuelvas a cobrar. Usa recuperar venta para consultar o completar la misma transacción.' : ''));
    } finally {
      if (stillCurrent()) { checkoutInFlight.current = false; setIsProcessingCheckout(false); }
    }
  };

  const handleDiscardCheckout = async () => {
    if (checkoutInFlight.current || !checkoutReviewKey.current || !checkoutReview?.requestId) return;
    if (!confirm('Se descartará solamente si la base de datos confirma que no existe la venta. Revisa el efectivo recibido con el responsable.')) return;
    const checkoutKey = checkoutReviewKey.current, binding = cartDraft.current;
    const stillCurrent = () => checkoutKey === checkoutReviewKey.current && binding === cartDraft.current;
    checkoutInFlight.current = true;
    setIsProcessingCheckout(true);
    try {
      await withCheckoutLock(checkoutKey, async () => {
        if (!stillCurrent()) return;
        const { error } = await supabase.rpc('pos_abandon_checkout', { p_request: checkoutReview.requestId });
        if (error) throw new Error(errorMessage(error));
        binding?.complete();
        localStorage.removeItem(checkoutKey);
        if (!stillCurrent()) return;
        setCheckoutReview(null); clearCart(); setShowCheckoutModal(false);
      });
    } catch (error) { if (stillCurrent()) alert(error instanceof Error ? errorMessage(error) : 'No se confirmó el descarte. Conservamos el registro pendiente.'); }
    finally { if (stillCurrent()) { checkoutInFlight.current = false; setIsProcessingCheckout(false); } }
  };

  const handleNextOrder = () => {
    setSavedSale(null);
    setShowPostSaleModal(false);
    clearCart();
    setActiveCustomer(null);
    fetchData();
  };

  const removeAccents = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const filteredProducts = products.filter(p =>
    p.is_active === true && removeAccents(p.name).includes(removeAccents(searchTerm))
  );

  const groupedProducts = filteredProducts.reduce<Record<string, CatalogProduct[]>>((acc, p) => {
    const cat = p.category || "Sin Categoría";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  // 🟢 LA MATEMÁTICA PROTEGIDA DEL CAMBIO
  const totalReceivedCombinedMXN = parseAmount(amountReceivedMXN) + (parseAmount(amountReceivedUSD) * parseAmount(exchangeRate));
  const isPaymentInsufficient = (paymentMethod === 'Efectivo' || paymentMethod === 'Mixto') && totalReceivedCombinedMXN < getTotal();

  const printStatus = <PrintDispatch key={printCheckoutKey} checkoutKey={printCheckoutKey} latestOrderId={savedSale?.id} />;
  const RegisterView = appearance === 'workspace' ? WorkspaceRegister : PrototypeRegister;
  const CheckoutView = appearance === 'workspace' ? WorkspaceCheckout : PrototypeCheckout;
  const CustomizationView = appearance === 'workspace' ? WorkspaceCustomization : PrototypeCustomization;
  const drawerBlocked = Boolean(showApertura && drawer && (drawer.handoff || (drawer.active && drawer.active.cashier_id !== drawerActor) || drawer.rate === null));

  return (
    <div className={`flex h-screen bg-[#F5F5F7] text-[#1D1D1F] font-sans antialiased overflow-hidden ${appearance==='workspace'?'pos-workspace':appearance==='prototype'?'pos-prototype':''}`}>

      {/* MODAL: APERTURA DE TURNO */}
      {drawerBlocked && drawer && <DrawerGate client={supabase} status={drawer} actor={drawerActor} isAdmin={isAdmin} reload={fetchData} logout={()=>void handleLogout()}/>}
      {showApertura && !drawerBlocked && appearance==='workspace' && <WorkspaceOpening userName={userName} isAdmin={isAdmin} denominations={DENOMINATIONS} counts={breakdown} onCounts={setBreakdown}
        rate={exchangeRate} onRate={setExchangeRate} dollars={dollarsInBox} onDollars={setDollarsInBox} total={calculateTotalCash()} busy={openingShift}
        disabled={loading||!!loadError} onOpen={()=>void handleStartShift()} onLogout={()=>void handleLogout()} />}
      {showApertura && !drawerBlocked && appearance!=='workspace' && (
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
              {appearance==='prototype'?<div className="flex flex-col gap-3">
                {isAdmin&&<a href="/admin" className="text-white underline">Administrar sin abrir caja</a>}
                <button onClick={()=>void handleLogout()} className="text-white border border-white/40">Cambiar usuario</button>
              </div>:<div className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">Mi Café System • 2026</div>}
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
                      readOnly
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
                disabled={openingShift || loading || !!loadError}
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
          <div role="dialog" aria-modal="true" aria-label={closeAction==='handoff'?'Entregar caja':'Cierre de caja'} className="bg-white rounded-[32px] w-full max-w-[950px] max-h-[calc(100dvh-24px)] overflow-y-auto shadow-2xl flex animate-in zoom-in-95 duration-200">

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
                      <span className="text-[10px] text-[#06c167] uppercase font-black tracking-widest">+ Ventas en efectivo</span>
                      <span className="text-sm font-bold text-[#06c167]">${cashSales.toFixed(2)}</span>
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
                   <button onClick={handleLogout} disabled={savingExpense || isClosingShift} className="flex items-center gap-2 text-red-400 font-bold hover:text-red-300 transition-colors text-sm">
                     <LogOut size={18}/> Salir y dejar mi turno abierto
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
                    <button onClick={handleAddExpense} disabled={savingExpense || isClosingShift || !!expenseError} className="bg-[#1d1d1f] flex-shrink-0 text-white w-10 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><Plus size={16}/></button>
                  </div>

                  {expenseError && <p role="alert" className="text-sm text-red-600 mt-2">{expenseError} <button className="underline" onClick={() => { setShowCierre(false); void fetchData(); }}>Reintentar conexión</button></p>}
                  {/* LISTA DE GASTOS */}
                  {expenses.length > 0 && (
                    <div className="flex flex-wrap gap-2 max-h-[60px] overflow-y-auto custom-scrollbar pt-3 mt-3 border-t border-slate-200/60">
                      {expenses.map((exp, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-semibold text-slate-600">{exp.desc}</span>
                          <span className="text-[11px] font-black text-red-500">-${exp.amount.toFixed(2)}</span>
                          <button onClick={() => { void handleRemoveExpense(i); }} disabled={savingExpense || isClosingShift || !!expenseError} className="text-slate-300 hover:text-red-500 transition-colors ml-1"><X size={12}/></button>
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

                <label className="block mb-3">Operación<select aria-label="Operación de cierre" disabled={isClosingShift} value={closeAction} onChange={e=>setCloseAction(e.target.value as 'close'|'handoff')} className="w-full border rounded p-3"><option value="close">Cerrar caja al terminar</option><option value="handoff">Entregar al siguiente cajero</option></select></label>
                {closeAction==='handoff'&&<label className="block mb-3">Recibirá la caja<select aria-label="Cajero que recibe" disabled={isClosingShift} value={handoffTarget} onChange={e=>setHandoffTarget(e.target.value)} className="w-full border rounded p-3"><option value="">Selecciona otro cajero</option>{drawer?.cashiers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><span>Se guarda tu corte. El siguiente cajero debe iniciar sesión y confirmar el efectivo recibido.</span></label>}
                <div className="flex gap-4">
                  <button disabled={isClosingShift} onClick={() => setShowCierre(false)} className="flex-1 bg-slate-100 text-slate-600 h-14 rounded-[20px] font-bold hover:bg-slate-200 transition-all disabled:opacity-50">
                    Volver al POS
                  </button>
                  <button onClick={handleSaveAndClose} disabled={isClosingShift || savingExpense || !!expenseError || (closeAction==='handoff'&&(!handoffTarget||items.length>0))} className="flex-1 bg-[#1d1d1f] text-white h-14 rounded-[20px] font-bold shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex justify-center items-center gap-2 disabled:opacity-50">
                    <Printer size={20} /> {isClosingShift ? 'Guardando…' : closeAction==='handoff' ? 'Guardar corte y entregar caja' : 'Guardar e Imprimir Z'}
                  </button>
                </div>
             </div>
          </div>
        </div>
      )}

      {appearance!=='owner' ? <RegisterView products={products} items={items} total={getTotal()} search={searchTerm} onSearch={setSearchTerm}
        userName={userName} isAdmin={isAdmin} disabled={loading||!!loadError||!!draftError||!!customerError||customerRestoring||!!checkoutReview||isClosingShift||isProcessingCheckout}
        onProduct={handleProductClick} onEdit={handleEditItem} onQuantity={updateQuantity} onRemove={removeItem} onClear={clearCart} onCheckout={handleOpenCheckout} onCloseShift={()=>void handleOpenCierre()}
        onHandoff={()=>void handleOpenCierre('handoff')}
        customer={activeCustomer} customerSearch={customerSearch} onCustomerSearch={handleCustomerSearchInput} suggestions={customerSuggestions} onCustomer={selectCustomer}
        onNewCustomer={handleOpenCustomerModal} onRemoveCustomer={()=>{setCustomerId(null);setActiveCustomer(null);setCustomerRestoring(false);setCustomerError(null);}}
        orderType={orderType} onOrderType={setOrderType} orderNote={orderNote} onOrderNote={setOrderNote} onReprint={ticket=>void reprintHistoricalTicket(ticket)} notices={<>
        {!showPostSaleModal && printStatus}
        {loadError && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo cargar el catálogo. {loadError}</p>
            <button onClick={() => { void fetchData(); }} className="mt-2 font-semibold underline">Reintentar conexión</button>
          </div>
        )}
        {(draftError || customerError) && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo recuperar o guardar el borrador. {draftError || customerError}</p>
            <div className="mt-2 flex gap-4">
              <button className="font-semibold underline" onClick={async () => {
                try {
                  if (cartDraft.current && !cartDraft.current.conflicted && !customerError) { cartDraft.current.flush(); setDraftError(null); }
                  else await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Reintentar borrador</button>
              {customerError && <button className="font-semibold underline" onClick={() => {
                setCustomerId(null); setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null);
              }}>Quitar cliente del borrador</button>}
              <button className="font-semibold underline" onClick={async () => {
                if (!draftStorageKey.current || !confirm('Se eliminará el borrador de carrito de este usuario. Una venta pendiente de revisión seguirá bloqueada hasta recuperarse.')) return;
                try {
                  localStorage.removeItem(draftStorageKey.current);
                  cartDraft.current?.disconnect(); cartDraft.current = null;
                  clearCart(); await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Descartar borrador</button>
            </div>
          </div>
        )}
        {checkoutReview && !isProcessingCheckout && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Venta pendiente de revisión{checkoutReview.ticketNumber != null ? ` · Folio ${checkoutReview.ticketNumber}` : ''}</p>
            <p>No vuelvas a cobrar. Importe: ${checkoutReview.total.toFixed(2)} · Inicio: {checkoutReview.startedAt}</p>
            <div className="mt-2 flex gap-4">
              <a href="/admin/ventas" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Revisar historial</a>
              {checkoutReview.requestId && checkoutReview.payload && <button className="font-semibold underline" onClick={processCheckout}>Recuperar la misma venta</button>}
              {checkoutReview.requestId && <button className="font-semibold underline" onClick={handleDiscardCheckout}>Descartar solicitud sin venta</button>}
              {!checkoutReview.requestId && <button className="font-semibold underline" onClick={() => {
                if (!confirm('Confirma que el responsable revisó el historial y resolvió esta venta. Se descartará la orden del carrito para evitar volver a cobrarla.')) return;
                try {
                  cartDraft.current?.complete();
                  localStorage.removeItem(checkoutReviewKey.current);
                  clearCart();
                  setShowCheckoutModal(false);
                  setCheckoutReview(null);
                } catch { alert('No se pudo actualizar el registro local. Conservamos el bloqueo de cobro.'); }
              }}>El responsable ya la revisó</button>}
            </div>
          </div>
        )}
        </>}/> : <>
      {/* POS PRINCIPAL */}
      <div className="flex-1 flex flex-col p-8 overflow-hidden">
        {!showPostSaleModal && printStatus}
        {loadError && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo cargar el catálogo. {loadError}</p>
            <button onClick={() => { void fetchData(); }} className="mt-2 font-semibold underline">Reintentar conexión</button>
          </div>
        )}
        {(draftError || customerError) && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo recuperar o guardar el borrador. {draftError || customerError}</p>
            <div className="mt-2 flex gap-4">
              <button className="font-semibold underline" onClick={async () => {
                try {
                  if (cartDraft.current && !cartDraft.current.conflicted && !customerError) { cartDraft.current.flush(); setDraftError(null); }
                  else await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Reintentar borrador</button>
              {customerError && <button className="font-semibold underline" onClick={() => {
                setCustomerId(null); setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null);
              }}>Quitar cliente del borrador</button>}
              <button className="font-semibold underline" onClick={async () => {
                if (!draftStorageKey.current || !confirm('Se eliminará el borrador de carrito de este usuario. Una venta pendiente de revisión seguirá bloqueada hasta recuperarse.')) return;
                try {
                  localStorage.removeItem(draftStorageKey.current);
                  cartDraft.current?.disconnect(); cartDraft.current = null;
                  clearCart(); await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Descartar borrador</button>
            </div>
          </div>
        )}
        {checkoutReview && !isProcessingCheckout && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Venta pendiente de revisión{checkoutReview.ticketNumber != null ? ` · Folio ${checkoutReview.ticketNumber}` : ''}</p>
            <p>No vuelvas a cobrar. Importe: ${checkoutReview.total.toFixed(2)} · Inicio: {checkoutReview.startedAt}</p>
            <div className="mt-2 flex gap-4">
              <a href="/admin/ventas" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Revisar historial</a>
              {checkoutReview.requestId && checkoutReview.payload && <button className="font-semibold underline" onClick={processCheckout}>Recuperar la misma venta</button>}
              {checkoutReview.requestId && <button className="font-semibold underline" onClick={handleDiscardCheckout}>Descartar solicitud sin venta</button>}
              {!checkoutReview.requestId && <button className="font-semibold underline" onClick={() => {
                if (!confirm('Confirma que el responsable revisó el historial y resolvió esta venta. Se descartará la orden del carrito para evitar volver a cobrarla.')) return;
                try {
                  cartDraft.current?.complete();
                  localStorage.removeItem(checkoutReviewKey.current);
                  clearCart();
                  setShowCheckoutModal(false);
                  setCheckoutReview(null);
                } catch { alert('No se pudo actualizar el registro local. Conservamos el bloqueo de cobro.'); }
              }}>El responsable ya la revisó</button>}
            </div>
          </div>
        )}
        <header className="mb-8 flex justify-between items-center">
          <div>
            <Image unoptimized width={512} height={512}
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

            <button onClick={()=>void handleOpenCierre('handoff')} className="border rounded-xl px-4">Cambiar cajero</button>
            <button onClick={()=>void handleOpenCierre()} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 px-4 py-3.5 rounded-[20px] hover:bg-slate-50 hover:text-red-500 transition-all font-semibold text-sm shadow-sm">
              <LogOut size={18} /> Terminar Turno
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto space-y-12 pr-4 custom-scrollbar">
          {Object.keys(groupedProducts).sort().map(cat => (
            <section key={cat}>
              <h2 className="text-[11px] font-black uppercase text-slate-400 mb-5 px-2 tracking-[0.2em]">{cat}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {groupedProducts[cat].map((p) => (
                  <div key={p.id} onClick={() => handleProductClick(p)} className="bg-white rounded-[2.5rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-xl transition-all cursor-pointer group border border-transparent hover:border-blue-50">
                    <div className="h-32 bg-slate-50 rounded-[20px] mb-4 overflow-hidden relative">
                      <ProductPhoto product={p} width={512} height={512} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
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

                <button onClick={handleOpenCustomerModal} className="p-3 bg-[#0071e3] text-white rounded-xl shadow-lg shadow-blue-50 hover:scale-105 transition-all flex-shrink-0">
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
                <button onClick={() => { setCustomerId(null); setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null); }} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"><X size={14} /></button>
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
                      {item.product.displayExtras?.map((e) => (
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
          <button onClick={handleOpenCheckout} disabled={items.length === 0 || loading || !!loadError || !!draftError || !!customerError || customerRestoring || !!checkoutReview || isClosingShift} className="w-full bg-[#0071e3] text-white h-16 rounded-[22px] font-semibold text-lg shadow-xl shadow-blue-100 hover:bg-[#0077ed] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none">
             <CreditCard size={22}/> Pagar Ahora
          </button>
        </div>
      </div>

      </>}
      {showCheckoutModal&&appearance!=='owner'&&<CheckoutView total={getTotal()} method={paymentMethod} mxn={amountReceivedMXN} usd={amountReceivedUSD} exchangeRate={parseAmount(exchangeRate)}
        orderType={orderType} note={orderNote} busy={isProcessingCheckout} insufficient={isPaymentInsufficient} onMethod={method=>{setPaymentMethod(method);setAmountReceivedMXN('');setAmountReceivedUSD('');}}
        onMXN={setAmountReceivedMXN} onUSD={setAmountReceivedUSD} onOrderType={setOrderType} onNote={setOrderNote} onConfirm={()=>void processCheckout()} onClose={()=>setShowCheckoutModal(false)}/>}
      {selectedProduct&&dynamicSteps.length>0&&appearance!=='owner'&&<CustomizationView product={selectedProduct} steps={dynamicSteps} index={customizationStep} extras={activeExtras} dbExtras={dbExtras}
        note={productNote} onNote={setProductNote} onStep={setCustomizationStep}
        quantity={editingItemId?items.find(item=>item.id===editingItemId)?.quantity:undefined}
        onQuantity={quantity=>{if(editingItemId)updateQuantity(editingItemId,quantity);}}
        onRemove={editingItemId?()=>{removeItem(editingItemId);setSelectedProduct(null);setEditingItemId(null);setActiveExtras([]);setProductNote('');}:undefined}
        onOption={(optName:string,stepIndex:number=customizationStep)=>{
          const step=dynamicSteps[stepIndex],matches=(extra:CartExtra)=>extra.name===optName&&(!extra.phase||extra.phase===step.id);
          const selected=activeExtras.some(matches),extra=dbExtras.find(e=>e.phase===step.id&&e.name===optName);
          setActiveExtras(selected?activeExtras.filter(e=>!matches(e)):[...activeExtras.filter(e=>!step.exclusive||e.phase!==step.id),{id:extra?.id,phase:step.id,name:optName,price:Number(extra?.price??0)}]);
          if(appearance==='prototype'&&!selected&&step.exclusive)setCustomizationStep(Math.min(customizationStep+1,lastStepIndex));
        }} onConfirm={handleConfirmAdd} onClose={()=>{setSelectedProduct(null);setEditingItemId(null);setActiveExtras([]);setProductNote('');}}/>}
      {/* 🟢 CHECKOUT DIVIDIDO EN 2 PASOS */}
      {showCheckoutModal && appearance==='owner' && (
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
                <button disabled={isProcessingCheckout} onClick={() => setShowCheckoutModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 transition-colors disabled:opacity-50"><X size={20}/></button>
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

      {showPostSaleModal && appearance==='workspace' && <WorkspaceDialog title="Venta guardada" onClose={handleNextOrder} className="workspace-sale">
        <div className="workspace-dialog-content"><p className="workspace-caption">Folio #{savedSale?.ticket_number ?? lastOrderId}</p><p className="workspace-sale-total">${(savedSale?.total ?? getTotal()).toFixed(2)} MXN</p>
          <p>Cliente → USB · Barra → Bluetooth. La venta no se vuelve a cobrar al reintentar impresión.</p>
          {printStatus}
        </div><footer><button className="workspace-primary" onClick={handleNextOrder}>Nueva venta</button></footer>
      </WorkspaceDialog>}
      {showPostSaleModal && appearance!=='workspace' && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-[#0071e3]/80 backdrop-blur-3xl" />

          <div className="relative bg-white/80 backdrop-blur-2xl rounded-[3rem] w-full max-w-[440px] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] p-12 text-center border border-white/40 animate-in zoom-in-95 duration-500">

             <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg shadow-green-500/20">
               <CheckCircle2 size={44} strokeWidth={1.5} />
             </div>

             <h2 className="text-[32px] font-semibold tracking-tight text-[#1d1d1f] mb-2">Venta Exitosa</h2>
             <p className="text-[#86868b] text-[17px] mb-10 font-medium leading-relaxed">
               La venta está guardada. Las copias de cliente y barra se envían a sus impresoras.
             </p>

             {printStatus}

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
      {selectedProduct && dynamicSteps.length > 0 && appearance==='owner' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-[130] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

            <div className="p-6 md:p-8 flex flex-col border-b border-slate-50 bg-white z-10">
              <div className="flex justify-between items-center mb-4">
                <div className="space-y-1">
                  <h3 className="text-2xl font-bold tracking-tight text-slate-800">{selectedProduct.name}</h3>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Paso {customizationStep + 1} de {dynamicSteps.length}</p>
                </div>
                <button onClick={() => {setSelectedProduct(null); setEditingItemId(null); setActiveExtras([]); setProductNote('');}} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors text-slate-500"><X size={20}/></button>
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
                    const stepConfig = dynamicSteps[customizationStep];
                    const matchesOption = (extra: CartExtra) => extra.name === optName && (!extra.phase || extra.phase === stepConfig.id);
                    const sel = activeExtras.some(matchesOption);
                    const dbExtra = dbExtras.find(e => e.phase === dynamicSteps[customizationStep].id && e.name.toLowerCase() === optName.toLowerCase());
                    const extraPrice = dbExtra ? Number(dbExtra.price) : 0;

                    return (
                      <button
                        key={optName}
                        onClick={() => {
                          let newExtras = [...activeExtras];
                          const isSelected = newExtras.find(matchesOption);
                          if (isSelected) { newExtras = newExtras.filter(e => !matchesOption(e)); }
                          else { if (stepConfig.exclusive) { newExtras = newExtras.filter(e => e.phase ? e.phase !== stepConfig.id : !stepConfig.options.includes(e.name)); } newExtras.push({ id: dbExtra?.id, phase: stepConfig.id, name: optName, price: extraPrice }); }
                          setActiveExtras(newExtras);

                          if (!isSelected && stepConfig.exclusive) {
                            setCustomizationStep(prev => Math.min(prev + 1, lastStepIndex));
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
              <h3 className="text-2xl font-black italic tracking-tight">{appearance==='workspace'?'Nuevo cliente':'Nuevo Miembro'}</h3>
              <button disabled={isRegistering} aria-label="Cerrar nuevo cliente" onClick={() => setShowCustomerModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-400"><X size={20}/></button>
            </div>
            <form onSubmit={handleRegisterCustomer} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" required placeholder="Nombre" className="p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.firstName} onChange={e => setCustomerForm({...customerForm, firstName: e.target.value})} />
                <input type="text" placeholder="Apellido (opcional)" className="p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.lastName} onChange={e => setCustomerForm({...customerForm, lastName: e.target.value})} />
              </div>
              <label className="block">Cumpleaños (opcional)<input type="date" aria-label="Cumpleaños opcional" className="w-full p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.birthDate} onChange={e => setCustomerForm({...customerForm, birthDate: e.target.value})} /></label>
              <input type="tel" placeholder="Teléfono / WhatsApp (opcional)" className="w-full p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.whatsapp} onChange={e => setCustomerForm({...customerForm, whatsapp: e.target.value})} />
              <p>Solo necesitas el nombre. Se seleccionará para esta compra. Puntos iniciales: 50.</p>
              {customerRegisterError&&<p role="alert">{customerRegisterError}</p>}
              {customerRegisterError&&<button type="button" disabled={isRegistering} onClick={()=>void handleRegisterCustomer({preventDefault(){}} as React.FormEvent)}>Reintentar la misma alta</button>}
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
