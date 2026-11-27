'use client';
import { posProfile } from '@/lib/pos-profile';
import { receivedCashMXN, usdCashQuote } from '@/lib/usd-cash';

import Image from 'next/image';
import ProductPhoto from '@/components/ProductPhoto';
import DrawerGate from './DrawerGate';
import { loadDrawerStatus, recoverDrawerRequest, beginDrawerHandoff, enrollCustomer, hasDrawerRequest, type DrawerStatus } from '@/lib/drawer';
import PrototypeRegister, {PrototypeCheckout, PrototypeCustomization} from './PrototypeRegister';
import './prototype.css';
import WorkspaceRegister, { WorkspaceCheckout, WorkspaceCustomization, WorkspaceOpening, WorkspaceDialog } from './WorkspaceRegister';
import RecentTickets from './RecentTickets';
import ClipPaymentStatus from './ClipPaymentStatus';
import { loadRegisterShortcuts } from '@/lib/register-shortcuts';
import { catalogChangeKey, catalogFingerprint, loadLiveCatalog, loadRegisterInventory } from '@/lib/catalog-management';
import './workspace.css';

import { catalogProduct, extraAppliesToProduct, isSmoothie, productAvailable, productStockLabel, validPagerNumber, type CatalogProduct, type Customer, type ExtraRow, type WizardStep, errorMessage } from '@/lib/pos-types';

import { matchesMenuCard, menuCardAvailable, menuCardPrice, menuCards, type MenuCard } from '@/lib/menu-cards';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { customizeProduct, useCartStore, type CartExtra, type CartItem, type Product } from '@/store/useCartStore';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { useRouter } from 'next/navigation';
import { openPrintWindow } from '@/lib/printing';
import PrintDispatch from './PrintDispatch';
import PagerPicker from './PagerPicker';
import PhoneOrders,{PhoneOrderContact} from './PhoneOrders';
import {beginPhoneRequest,canPrintPhoneOrder,completePhoneRequest,getPhoneOrder,readPhoneRequest,submitPhoneRequest,validPhoneContact,withPhoneLock,type PhoneOrder,type PhoneRequest,type PhoneReturn} from '@/lib/phone-orders';
import { printSavedShift } from '@/lib/shift-printing';
import { confirmClosingPrints } from '@/lib/closing-print-check';
import { printHistoricalReceipt } from '@/lib/receipt-reprint';
import './printing.css';
import { rememberSalePrint,rememberPhonePrint } from '@/lib/sale-printing';
import type { ShiftReport } from '@/lib/shift';
import { closeRequestKey, closeShift, expenseRequestKey, loadShiftSummary, recoverPendingExpenses, recoverShiftClose, restoreShiftExpenses, saveShiftExpenses, type ShiftSummary } from '@/lib/shift-state';
import { CheckoutRejected, ClipPaymentPending, checkoutPayload, executeCheckout, readCheckoutReview, withCheckoutLock, type CheckoutReview, type SavedOrder } from '@/lib/checkout';
import { bindCartDraft, cartDraftKey, type CartDraftBinding } from '@/lib/cart-draft';
import { withDeadline } from '@/lib/request-deadline';
import { isDefinitiveWriteRejection } from '@/lib/write-outcome';
import {
  Coffee, Minus, Plus, Trash2, CreditCard, ShoppingBag,
  Loader2, Search, X, UserPlus, Edit3, LogOut, Wallet,
  DollarSign, CheckCircle2, Printer, ChevronRight, ChevronLeft, Receipt
} from 'lucide-react';

// DENOMINACIONES DE DINERO
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50];

export default function POSPage({appearance='workspace',clipEnabled=false,smoothies=false}:{appearance?:'owner'|'prototype'|'workspace';clipEnabled?:boolean;smoothies?:boolean}={}) {
  const { items, addItem, removeItem, replaceItem, updateQuantity, getTotal, clearCart,
    orderType, orderNote, pagerNumber, phoneOrder,phoneName,phoneContact,setPhoneOrder,setPhoneName,setPhoneContact,customerId, setOrderType, setOrderNote, setPagerNumber, setCustomerId } = useCartStore();
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
  const [phonePending,setPhonePending]=useState<PhoneRequest|null>(null),[phoneError,setPhoneError]=useState(''),[phoneBusy,setPhoneBusy]=useState(false);
  const phoneInFlight=useRef(false);
  const [showPhoneContact,setShowPhoneContact]=useState(false),[showPhoneOrders,setShowPhoneOrders]=useState(false),[selectedPhoneOrder,setSelectedPhoneOrder]=useState<PhoneOrder|null>(null);
  const [phonePrintId,setPhonePrintId]=useState(''),[savedPhone,setSavedPhone]=useState<PhoneOrder|null>(null);
  const [phonePrintNotice,setPhonePrintNotice]=useState('');


  // 🟢 FUNCIÓN ROBUSTA PARA PARSEAR DINERO (Evita errores de NaN y comas decimales)
  const parseAmount = (val: unknown) => {
    if (val === '' || val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const parsed = Number(String(val).replace(/,/g, '.'));
    return isNaN(parsed) ? 0 : parsed;
  };

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [weeklySpecialId, setWeeklySpecialId] = useState<string | null>(null);
  const [favoritesError, setFavoritesError] = useState('');
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesAttempt, setFavoritesAttempt] = useState(0);
  const [catalogStale, setCatalogStale] = useState(false);
  const [catalogCheckError, setCatalogCheckError] = useState('');
  const [dbExtras, setDbExtras] = useState<ExtraRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketSearchTerm, setTicketSearchTerm] = useState('');
  const [userName, setUserName] = useState('Barista');
  const [isAdmin,setIsAdmin]=useState(false);
  const [drawer, setDrawer] = useState<DrawerStatus | null>(null);
  const [drawerActor, setDrawerActor] = useState('');
  const [closeAction, setCloseAction] = useState<'close'|'handoff'>('close');
  const [countConfirmed,setCountConfirmed] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState('');

  useEffect(() => {
    if (!drawerActor || (sessionActor !== null && drawerActor !== sessionActor)) return;
    const controller = new AbortController();
    void loadRegisterShortcuts(supabase, controller.signal).then(value => {
      if (!controller.signal.aborted) setFavoriteProductIds(value.product_ids);
    }).catch(() => {
      if (!controller.signal.aborted) setFavoritesError('No se pudieron cargar los favoritos. Puedes usar el catálogo.');
    }).finally(() => { if (!controller.signal.aborted) setFavoritesLoading(false); });
    return () => controller.abort();
  }, [drawerActor, sessionActor, favoritesAttempt]);

  useEffect(() => {
    if (!smoothies || !drawerActor || (sessionActor && sessionActor !== drawerActor)) return;
    let current: AbortController | undefined;
    const refresh = async () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const { data, error } = await supabase.rpc('pos_smoothies_special')
        .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
      if (!controller.signal.aborted && !error) setWeeklySpecialId(data?.product_id ?? null);
    };
    const changed = (event: StorageEvent) => { if (event.key === catalogChangeKey) void refresh(); };
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(catalogChangeKey, refresh);
    window.addEventListener('storage', changed);
    return () => {
      current?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(catalogChangeKey, refresh);
      window.removeEventListener('storage', changed);
    };
  }, [drawerActor, sessionActor, smoothies]);

  // ESTADOS DE TURNO
  const [registerId, setRegisterId] = useState('');
  const [openingShift, setOpeningShift] = useState(false);
  const openingInFlight = useRef(false);
  const shiftMemoryKey = useRef('');
  const [savedSale, setSavedSale] = useState<SavedOrder | null>(null);
  const [showApertura, setShowApertura] = useState(false);
  const [showCierre, setShowCierre] = useState(false);
  const [savedExit, setSavedExit] = useState<'close' | 'handoff' | null>(null);
  const [closeCheck, setCloseCheck] = useState<{ register: string; action: 'close' | 'handoff'; error: string } | null>(null);
  const [preparingNextShift, setPreparingNextShift] = useState(false);
  const nextShiftLoad = useRef(false);
  const [logoutError, setLogoutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const logoutInFlight = useRef(false);
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

  // Impresión y personalización.
  const [showPostSaleModal, setShowPostSaleModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const cards = useMemo(() => menuCards(products), [products]);
  const selectedFamily = cards.find(card => card.id === selectedFamilyId);
  const [activeExtras, setActiveExtras] = useState<CartExtra[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState(1);
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
      shiftSaved.current = false; setSavedExit(null); setCloseCheck(null); setLogoutError(false);
      useCartStore.getState().clearCart(); setActiveCustomer(null); setCheckoutReview(null);
      setIsProcessingCheckout(false); setShowCheckoutModal(false); setShowPostSaleModal(false); setSelectedProduct(null); setSelectedFamilyId(null); setSavedSale(null);
      setPhonePending(null);setPhoneError('');setPhoneBusy(false);phoneInFlight.current=false;setShowPhoneContact(false);setShowPhoneOrders(false);setSelectedPhoneOrder(null);setSavedPhone(null);setPhonePrintId('');setPhonePrintNotice('');
      setProducts([]); setFavoriteProductIds([]); setFavoritesError(''); setFavoritesLoading(true); setDbExtras([]); setDraftError(null); setCustomerError(null);
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
    const [catalog, extras, shift, inventory] = await Promise.all([
      supabase.from('products').select('*').order('name').abortSignal(signal),
      supabase.from('extras').select('*').order('phase').abortSignal(signal),
      supabase.from('cash_registers').select('id,opened_at,initial_balance,exchange_rate').eq('opened_by',user.id).eq('status','open').abortSignal(signal).maybeSingle(),
      loadRegisterInventory(supabase, signal),
    ]);
    for (const result of [catalog, extras, shift]) if (result.error) throw result.error;
    if (shift.data && !shift.data.exchange_rate) throw new Error('El turno anterior requiere conciliación antes de usar esta versión.');
    const summary = shift.data ? await restoreShiftExpenses(supabase, localStorage, user.id, shift.data.id, signal) : null;
    return { user, drawer, profile:profile.data, products:(catalog.data || []).map(row => ({...catalogProduct(row),inventory:inventory.get(row.id)})), extras:(extras.data || []) as ExtraRow[], shift:shift.data, summary };
  }, [sessionActor]);
  const applyPOS = useCallback((data: Awaited<ReturnType<typeof loadPOS>> | null) => {
    if (!data) { router.replace('/login'); return; }
    if (shiftSaved.current && draftOwner.current === data.user.id && !nextShiftLoad.current) return;
    setUserName(data.profile.full_name);
    setIsAdmin(data.profile.role==='admin');
    setDrawer(data.drawer);
    setDrawerActor(data.user.id);
    draftOwner.current = data.user.id;
    checkoutReviewKey.current = `mi_cafe_checkout_review:${data.user.id}`;
    setPrintCheckoutKey(`mi_cafe_checkout_review:${data.user.id}`);
    shiftMemoryKey.current = `mi_cafe_shift:${data.user.id}`;
    shiftSaved.current = false;
    if (nextShiftLoad.current) {
      setBreakdown(DENOMINATIONS.reduce<Record<number, number>>((counts, denomination) => {
        counts[denomination] = 0;
        return counts;
      }, {}));
      setDollarsInBox('');
      setCountConfirmed(false);
      setSavedExit(null);
      setLogoutError(false);
    }
    shiftSummary.current = data.summary; setExpenseError(null);
    draftStorageKey.current = cartDraftKey(data.user.id);
    try { setCheckoutReview(readCheckoutReview(localStorage.getItem(checkoutReviewKey.current))); }
    catch { setCheckoutReview({ startedAt:'Registro pendiente ilegible', total:0 }); }
    try {setPhonePending(readPhoneRequest(localStorage,data.user.id));setPhoneError('');}catch(error){setPhoneError(errorMessage(error));}
    setProducts(data.products);
    setDbExtras(data.extras);
    setCatalogStale(false); setCatalogCheckError('');
    cartDraft.current?.disconnect(); cartDraft.current = null;
    useCartStore.getState().clearCart();
    setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null); setDraftError(null);
    if (data.shift) {
      try {
        const binding = bindCartDraft({ storage: localStorage, userId: data.user.id, registerId: data.shift.id,
          products: data.products, extras: data.extras, onError: setDraftError,
          onRepriced: () => alert('Los precios cambiaron. Revisa el total antes de cobrar.') });
        cartDraft.current = binding;
        if (binding.customerId) {
          setCustomerRestoring(true);
          void supabase.from('customers').select('*').eq('id', binding.customerId).abortSignal(AbortSignal.timeout(12_000)).maybeSingle().then(({ data: customer, error }) => {
            if (cartDraft.current !== binding || useCartStore.getState().customerId !== binding.customerId) return;
            setCustomerRestoring(false);
            if (error || !customer) setCustomerError('No se pudo cargar el cliente. Vuelve a seleccionarlo antes de cobrar.');
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
    } else { setRegisterId(''); setExpenses([]); setCashSales(0); setExchangeRate(data.drawer.rate ? String(data.drawer.rate) : smoothies ? '1' : ''); setShowApertura(true); }
  }, [router, smoothies]);
  const { loading, error: loadError, reload: fetchData } = useResource(loadPOS, null, applyPOS);

  useEffect(() => {
    if (loading || !drawerActor || (sessionActor !== null && sessionActor !== drawerActor)) return;
    const controller = new AbortController();
    let checking = false;
    const current = catalogFingerprint(products, dbExtras, favoriteProductIds);
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const latest = await withDeadline(() => loadLiveCatalog(supabase, controller.signal), { signal: controller.signal });
        if (!controller.signal.aborted) { setCatalogStale(latest !== current); setCatalogCheckError(''); }
        const inventory = await withDeadline(() => loadRegisterInventory(supabase, controller.signal), { signal: controller.signal });
        if (!controller.signal.aborted) setProducts(previous => previous.map(p => ({...p,inventory:inventory.get(p.id)})));
      } catch {
        if (!controller.signal.aborted) setCatalogCheckError('No se pudo comprobar si el menú cambió.');
      } finally { checking = false; }
    };
    const changed = (event: StorageEvent) => { if (event.key === catalogChangeKey || event.key === null) void check(); };
    const poll = window.setInterval(() => void check(), 30_000);
    window.addEventListener('focus', check); window.addEventListener(catalogChangeKey, check); window.addEventListener('storage', changed);
    return () => { controller.abort(); window.clearInterval(poll); window.removeEventListener('focus', check); window.removeEventListener(catalogChangeKey, check); window.removeEventListener('storage', changed); };
  }, [loading, drawerActor, sessionActor, products, dbExtras, favoriteProductIds]);

  const refreshCatalog = () => {
    if (loading || selectedProduct || showCheckoutModal || checkoutInFlight.current || checkoutReview || expenseInFlight.current || closingShift.current || openingInFlight.current) return;
    setFavoritesAttempt(value => value + 1);
    void fetchData();
  };

  const calculateTotalCash = () => {
    const pesos = Object.entries(breakdown).reduce((sum, [den, qty]) => sum + (Number(den) * qty), 0);
    return receivedCashMXN(pesos, parseAmount(dollarsInBox), parseAmount(exchangeRate));
  };

  const handleStartShift = async () => {
    if (openingInFlight.current || loading || loadError) return;
    if (!exchangeRate || !Number.isFinite(parseAmount(exchangeRate)) || parseAmount(exchangeRate) <= 0
      || parseAmount(exchangeRate)>1000 || Math.round(parseAmount(exchangeRate)*10000)/10000 !== parseAmount(exchangeRate)
      || !Number.isFinite(calculateTotalCash()) || calculateTotalCash()<0 || calculateTotalCash()>10000000
      || Object.values(breakdown).some(q=>!Number.isInteger(q)||q<0) || parseAmount(dollarsInBox)<0
      || !Number.isFinite(Number(dollarsInBox)) || Math.round(Number(dollarsInBox)*100)/100!==Number(dollarsInBox)) {
      alert("Revisa el tipo de cambio y el efectivo inicial.");
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
      const { data, error } = await withDeadline(() => supabase.rpc('pos_open_shift', pending));
      if (error) throw error;
      if (!data?.id) throw new Error('No se confirmó la apertura. Pulsa de nuevo para comprobarla.');
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
      if (error && typeof error==='object' && 'code' in error && isDefinitiveWriteRejection(error.code)) {
        localStorage.removeItem(`${shiftMemoryKey.current}:opening`);
        alert('No se abrió la caja. Revisa los importes y vuelve a intentar.');
        await fetchData();
        return;
      }
      alert('No se confirmó la apertura. Comprueba el estado de la caja. ' + (error instanceof Error ? errorMessage(error) : 'Revisa la conexión.'));
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
      if (draftOwner.current === owner) setExpenseError('No se confirmó el gasto. Vuelve a comprobarlo antes de agregar otro. ' + errorMessage(failure));
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
    if (items.length) { alert('Termina o vacía la orden actual antes de cerrar o entregar la caja.'); return; }
    const owner = draftOwner.current;
    try {
      const summary = await loadShiftSummary(supabase, registerId);
      if (draftOwner.current !== owner || summary.status !== 'open') return;
      if (localStorage.getItem(expenseRequestKey(owner))) throw new Error('Hay un gasto sin confirmar. Compruébalo antes de agregar otro.');
      shiftSummary.current = summary; setExpenses(summary.expenses); setCashSales(summary.cash_sales);
      setCloseAction(action); setHandoffTarget(''); setCountConfirmed(false);
      setBreakdown(DENOMINATIONS.reduce((acc, den) => ({ ...acc, [den]: 0 }), {})); setDollarsInBox('');
      setShowCierre(true);
    } catch (failure) { alert('No se pudo consultar el corte. El turno sigue abierto. ' + errorMessage(failure)); }
  };

  const handleLogout = async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    const afterClose = shiftSaved.current;
    setLogoutError(false);
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      cartDraft.current?.disconnect(); cartDraft.current = null;
      clearCart();
      router.replace('/login');
      router.refresh();
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      if (afterClose) setLogoutError(true);
      else alert('No se pudo cerrar la sesión. Revisa la conexión y vuelve a intentar.');
    } finally {
      logoutInFlight.current = false;
      setSigningOut(false);
    }
  };

  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const expectedCash = Math.round((startingCash + cashSales - totalExpenses) * 100) / 100;
  const countedCash = calculateTotalCash();
  const difference = countedCash - expectedCash;

  const printZReport = (target: Window, report: ShiftReport) => printSavedShift(target, {...report,user_name: (report as {user_name?:string}).user_name ?? userName,opened_at:(report as {opened_at?:string}).opened_at ?? shiftStartTime ?? undefined});

  const finishClose = (action: 'close' | 'handoff') => {
    shiftSaved.current = true;
    shiftSummary.current = null;
    cartDraft.current?.disconnect();
    cartDraft.current = null;
    clearCart();
    setRegisterId('');
    setShowCierre(false);
    setCloseCheck(null);
    setSavedExit(action);
    void fetch('/api/backups', { method: 'POST', headers: { 'X-Pos-Backup': 'checkpoint' }, keepalive: true }).catch(() => {});
  };

  const handlePrepareNextShift = async () => {
    if (nextShiftLoad.current || logoutInFlight.current) return;
    nextShiftLoad.current = true;
    setPreparingNextShift(true);
    try { await fetchData(); }
    finally { nextShiftLoad.current = false; setPreparingNextShift(false); }
  };

  const hasPendingClose = (owner: string, action: 'close' | 'handoff') =>
    action === 'handoff' ? hasDrawerRequest(localStorage, owner, 'handoff') : !!localStorage.getItem(closeRequestKey(owner));

  const handleVerifyClose = async () => {
    if (!closeCheck || closingShift.current) return;
    const { register, action } = closeCheck;
    const owner = draftOwner.current;
    closingShift.current = true;
    setIsClosingShift(true);
    try {
      let summary = await loadShiftSummary(supabase, register);
      if (draftOwner.current !== owner) return;
      let handoffConfirmed = false;
      if (hasPendingClose(owner, action)) {
        // Use the original request when the first response was lost.
        if (action === 'handoff') handoffConfirmed = !!await recoverDrawerRequest(supabase, localStorage, owner, 'handoff');
        else await recoverShiftClose(supabase, localStorage, owner);
        summary = await loadShiftSummary(supabase, register);
      }
      if (draftOwner.current !== owner) return;
      if (summary.status === 'closed') {
        finishClose(handoffConfirmed ? 'handoff' : 'close');
        if (handoffConfirmed) await handleLogout();
      } else {
        shiftSummary.current = summary;
        setExpenses(summary.expenses);
        setCashSales(summary.cash_sales);
        setCountConfirmed(false);
        setCloseCheck(null);
        setShowCierre(true);
      }
    } catch (error) {
      if (draftOwner.current === owner) setCloseCheck({ register, action, error: errorMessage(error) });
    } finally {
      closingShift.current = false;
      if (draftOwner.current === owner) setIsClosingShift(false);
    }
  };

  const handleSaveAndClose = async () => {
    if (shiftSaved.current || closingShift.current || expenseInFlight.current || expenseError || !shiftSummary.current) return;
    if (!Number.isFinite(countedCash) || countedCash<0 || countedCash>10000000 || Object.values(breakdown).some(q=>!Number.isInteger(q)||q<0)
      || !Number.isFinite(parseAmount(dollarsInBox)) || parseAmount(dollarsInBox)<0 || Math.round(parseAmount(dollarsInBox)*100)/100!==parseAmount(dollarsInBox)) {
      alert('Revisa el conteo: piezas enteras y dólares con máximo dos decimales, sin cantidades negativas.');return;
    }
    if(items.length){alert('Termina o vacía la orden actual antes de cerrar o entregar la caja.');return;}
    if(!countConfirmed){alert('Confirma que terminaste de contar el efectivo, incluso si la caja está vacía.');return;}
    if(closeAction==='handoff'&&!handoffTarget){alert('Selecciona al siguiente cajero.');return;}
    if(!confirm(`Efectivo contado: ${countedCash.toFixed(2)} MXN. Diferencia: ${difference.toFixed(2)} MXN. ${countedCash===0?'Confirmas que la caja está vacía. ':''}¿Guardar este corte definitivo?`))return;
    const summary = shiftSummary.current, owner = draftOwner.current;
    closingShift.current = true;
    setIsClosingShift(true);
    // Reserve the popup during the user click; do not print an unsaved close.
    const printWindow = openPrintWindow();
    try {
      if(!await confirmClosingPrints()){printWindow?.close();return;}
      const report = closeAction === 'handoff' ? await beginDrawerHandoff(supabase, localStorage, owner, summary, countedCash, handoffTarget) : await closeShift(supabase, localStorage, owner, summary, countedCash);
      if (draftOwner.current !== owner) { printWindow?.close(); return; }
      finishClose(closeAction);
      try { if (printWindow) printZReport(printWindow, report); }
      catch { printWindow?.close(); alert('El corte se guardó, pero no se pudo abrir la impresión.'); }
      if (closeAction === 'handoff') await handleLogout();
    } catch (error) {
      printWindow?.close();
      if (draftOwner.current !== owner || shiftSaved.current) return;
      setShowCierre(false);
      setCloseCheck({ register: summary.register_id, action: closeAction, error: errorMessage(error) });
    } finally {
      closingShift.current = false;
      if (draftOwner.current === owner) setIsClosingShift(false);
    }
  };

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchError,setCustomerSearchError] = useState('');
  const [customerSearching,setCustomerSearching] = useState(false);
  const customerSearchRevision = useRef(0);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const registeringCustomer = useRef(false);
  const [customerRegisterError, setCustomerRegisterError] = useState('');
  const [customerForm, setCustomerForm] = useState({ firstName: '', lastName: '', birthDate: '', whatsapp: '', acceptPromos: false });
  const handleOpenCustomerModal = () => {
    try { setCustomerRegisterError(hasDrawerRequest(localStorage,draftOwner.current,'customer') ? 'El cliente todavía no se ha confirmado. Pulsa de nuevo para comprobarlo.' : ''); }
    catch(error) { setCustomerRegisterError(errorMessage(error)); }
    setShowCustomerModal(true);
  };

  const handleCustomerSearchInput = async (value: string) => {
    const revision = ++customerSearchRevision.current;
    setCustomerSearch(value); setCustomerSearchError(''); setCustomerSearching(value.trim().length>=2);
    setCustomerSuggestions([]);
    if (value.trim().length < 2) { setShowSuggestions(false); return; }
    setShowSuggestions(true);
    try {
      const { data, error } = await withDeadline(() => supabase.rpc('pos_search_customers', { p_search: value }));
      if(error)throw new Error('No se pudo buscar. Revisa internet y toca Reintentar.');
      if (revision === customerSearchRevision.current && Array.isArray(data)) {
        setCustomerSuggestions(data);
      }
    } catch (err) { if(revision===customerSearchRevision.current)setCustomerSearchError(errorMessage(err)); }
    finally {if(revision===customerSearchRevision.current)setCustomerSearching(false);}
  };

  const selectCustomer = (customer: Customer) => {
    customerSearchRevision.current++; setCustomerSearchError(''); setCustomerSearching(false);
    setCustomerId(customer.id);
    setCustomerRestoring(false);
    setCustomerError(null);
    setActiveCustomer(customer);
    setCustomerSearch('');
    setCustomerSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSearchCustomer = async () => {
    if (customerSearch.trim().length < 2) return;
    const revision = ++customerSearchRevision.current;
    try {
      const { data, error } = await withDeadline(() => supabase.rpc('pos_search_customers', { p_search: customerSearch }));
      if (revision !== customerSearchRevision.current) return;
      if (error) throw new Error('No se pudo buscar. Revisa internet e intenta de nuevo.');
      if (!Array.isArray(data) || !data.length) { alert('Cliente no encontrado'); return; }
      // Never silently attach the first of several customers with similar phones/names.
      if (data.length === 1) selectCustomer(data[0]);
      else { setCustomerSuggestions(data); setShowSuggestions(true); }
    } catch (error) { if (revision === customerSearchRevision.current) alert(errorMessage(error)); }
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
       const phaseOptions = dbExtras.filter(e => e.phase === phaseName && e.active && extraAppliesToProduct(e, product.id)).map(e => e.name);
       const phaseLabel = phaseName === 'Leche alternativa Matcha' ? 'Leche alternativa'
          : phaseName === 'Cold foam Matcha' ? 'Cold foam' : phaseName === 'Jarabe Brownie' ? 'jarabe' : phaseName;
       return {
          id: phaseName,
          title: `Seleccionar ${phaseLabel}`,
          options: phaseOptions,
          exclusive: ['Tamaño', 'Tipo de Leche', 'Leche alternativa', 'Leche alternativa Matcha', 'Creamer', 'Helado gourmet', 'Temperatura', 'Jarabe Brownie'].includes(phaseName),
          required: ['Helado gourmet', 'Temperatura', 'Jarabe Brownie'].includes(phaseName)
       };
    }).filter((step) => step.options.length > 0);
    return steps.length ? [...steps,{id:'notes',title:'Notas',options:[],exclusive:false}] : steps;
  }, [dbExtras]);

  const handleProductClick = useCallback((product: Product) => {
    if (!cartDraft.current || draftError || loading || loadError) return;
    if (!productAvailable(product)) { alert('Este producto está agotado.'); return; }
    const quantity = useCartStore.getState().items.filter(i=>i.product.id===product.id).reduce((sum,i)=>sum+i.quantity,0);
    if (product.inventory?.mode==='counted' && product.inventory.quantity!==null && quantity>=product.inventory.quantity) { alert('Ya agregaste las existencias disponibles.'); return; }
    setEditingItemId(null);
    const steps = buildWizardSteps(product);

    if (steps.length === 0 && !(smoothies && appearance === 'workspace' && isSmoothie(product))) {
      addItem({ ...product, price: Number(product.price), basePrice: Number(product.price), displayExtras: [], note: '' });
    } else {
      setSelectedProduct(product);
      setActiveExtras([]);
      setProductNote('');
      setDynamicSteps(steps);
      setCustomizationStep(0);
    }
  }, [appearance, smoothies, draftError, loading, loadError, addItem, buildWizardSteps]);

  const handleMenuCardClick = useCallback((card: MenuCard) => {
    if (!cartDraft.current || draftError || loading || loadError || !menuCardAvailable(card)) return;
    if (card.variants && card.variants.length > 1) {
      setSelectedProduct(null);
      setEditingItemId(null);
      setProductNote('');
      setActiveExtras([]);
      setDynamicSteps([]);
      setCustomizationStep(0);
      setSelectedFamilyId(card.id);
    }
    else handleProductClick(card.variants?.[0].product ?? card);
  }, [draftError, loading, loadError, handleProductClick]);

  const handleVariant = (id: string | null) => {
    if (id === null) {
      setSelectedProduct(null);
      setDynamicSteps([]);
      setCustomizationStep(0);
      return;
    }
    const product = selectedFamily?.variants?.find(variant => variant.product.id === id)?.product;
    if (!product || !productAvailable(product) || selectedProduct?.id === id) return;
    const steps = buildWizardSteps(product);
    setSelectedProduct(product);
    setDynamicSteps(steps);
    setActiveExtras(previous => previous.filter(extra =>
      steps.some(step => step.id === extra.phase && step.options.includes(extra.name))));
    setCustomizationStep(0);
  };

  const handleEditItem = (item: CartItem) => {
    const current = products.find(product => product.id === item.product.id);
    const editable = current ? { ...item.product, customizable:current.customizable, wizard_steps:current.wizard_steps } : item.product;
    const configured = buildWizardSteps(editable);
    const steps = configured.length ? configured : [{id:'notes',title:'Notas',options:[],exclusive:false}];

    setSelectedProduct(editable);
    setSelectedFamilyId(cards.find(card => (card.variants?.length ?? 0) > 1 &&
      card.variants?.some(variant => variant.product.id === item.product.id))?.id ?? null);
    const previousExtras = item.product.displayExtras || [];
    setActiveExtras(smoothies && isSmoothie(editable) ? previousExtras.filter(extra => configured.some(step =>
      (!extra.phase || extra.phase === step.id) && step.options.includes(extra.name))) : previousExtras);
    setProductNote(item.product.note || '');
    setEditingItemId(item.id);
    setEditingQuantity(item.quantity);
    setDynamicSteps(steps);
    setCustomizationStep(0);
  };

  const handleConfirmAdd = () => {
    if (!selectedProduct) return;
    const missing = dynamicSteps.find(step => step.required && !activeExtras.some(extra => extra.phase === step.id && step.options.includes(extra.name)));
    if (missing) { alert(`Elige una opción de ${missing.id.toLowerCase()}.`); return; }
    const latest = products.find(p => p.id === selectedProduct.id);
    const requested = items.filter(i => i.product.id === selectedProduct.id && i.id !== editingItemId).reduce((sum,i) => sum+i.quantity,0) + (editingItemId ? editingQuantity : 1);
    if (latest && (!productAvailable(latest) || (latest.inventory?.mode === 'counted' && latest.inventory.quantity !== null && requested > latest.inventory.quantity))) { alert('Revisa las existencias disponibles.'); return; }
    const productWithExtras = customizeProduct(selectedProduct, activeExtras, productNote);
    if (editingItemId) replaceItem(editingItemId, productWithExtras, editingQuantity);
    else addItem(productWithExtras);
    closeCustomization();
  };

  const closeCustomization = () => {
    setSelectedFamilyId(null);
    setEditingItemId(null);
    setSelectedProduct(null);
    setActiveExtras([]);
    setProductNote('');
  };

  const chooseExtra = (name: string, index = customizationStep) => {
    const step = dynamicSteps[index];
    const matches = (extra: CartExtra) => extra.name === name && (!extra.phase || extra.phase === step.id);
    const selected = activeExtras.some(matches);
    const extra = dbExtras.find(e => e.phase === step.id && e.name === name && e.active && selectedProduct && extraAppliesToProduct(e, selectedProduct.id));
    if (!extra) return;
    setActiveExtras(selected ? activeExtras.filter(e => !matches(e)) : [
      ...activeExtras.filter(e => !step.exclusive || e.phase !== step.id),
      { id: extra.id, phase: step.id, name, price: Number(extra.price ?? 0) },
    ]);
    if (appearance === 'prototype' && !selected && step.exclusive) setCustomizationStep(Math.min(customizationStep + 1, lastStepIndex));
  };

  const handleOpenCheckout = () => {
    for (const product of products) {
      const quantity = items.filter(i => i.product.id === product.id).reduce((sum,i) => sum+i.quantity,0);
      if (quantity && (!productAvailable(product) || (product.inventory?.mode === 'counted' && product.inventory.quantity !== null && quantity > product.inventory.quantity))) { alert(`Revisa las existencias de ${product.name}.`); return; }
    }
    if (catalogStale) { alert('El menú cambió. Actualízalo y revisa el pedido antes de cobrar.'); return; }
    if (loading || loadError || draftError || customerError || customerRestoring || closingShift.current || shiftSaved.current) return;
    if (checkoutReview || checkoutInFlight.current) {
      alert('Revisa la venta pendiente antes de iniciar otro cobro.');
      return;
    }
    if (items.length === 0) return;
    if(phonePending||phoneBusy||phoneError){alert('Comprueba el pedido sin confirmar antes de continuar.');return;}
    if(phoneOrder){setShowPhoneContact(true);return;}
    if (!smoothies && !validPagerNumber(pagerNumber)) { alert('Elige un control del 1 al 30 antes de cobrar.'); return; }
    setSelectedPhoneOrder(null);
    setPaymentMethod('Efectivo');
    setAmountReceivedMXN('');
    setAmountReceivedUSD('');
    setCheckoutStep(1);
    setShowCheckoutModal(true);
  };

  const handlePhoneRequest = async (recover=false,cancellation?:{order:PhoneOrder;reason:string;returns:PhoneReturn[]}) => {
    if(phoneInFlight.current||checkoutInFlight.current||checkoutReview||closingShift.current)return false;
    const actor=draftOwner.current,binding=cartDraft.current;
    phoneInFlight.current=true;setPhoneBusy(true);setPhoneError('');
    try {
      return await withPhoneLock(actor,()=>withCheckoutLock(`mi_cafe_checkout_review:${actor}`,async()=>{
        const payment=readCheckoutReview(localStorage.getItem(`mi_cafe_checkout_review:${actor}`));
        if(payment){if(draftOwner.current===actor)setCheckoutReview(payment);throw new Error('Hay una venta sin confirmar. Compruébala antes de guardar otro pedido.');}
        let request=readPhoneRequest(localStorage,actor);
        if(recover){if(!request)throw new Error('No hay un pedido sin confirmar.');}
        else {
          if(request){setPhonePending(request);throw new Error('Comprueba el pedido sin confirmar antes de guardar otro.');}
          if(cancellation)request={actor,request:crypto.randomUUID(),kind:'cancel',id:cancellation.order.id,revision:cancellation.order.revision,reason:cancellation.reason.trim(),returns:cancellation.returns};
          else {
            if(!binding||!items.length||draftError||catalogStale||customerRestoring||customerError)throw new Error('Revisa el pedido antes de guardarlo.');
            if(!phoneOrder||!validPhoneContact(phoneName,phoneContact))throw new Error('Escribe el nombre y un teléfono de 10 a 15 dígitos.');
            request={actor,request:binding.requestId(),kind:'save',payload:{items:items.map(line=>({product_id:line.product.id,quantity:line.quantity,extra_ids:(line.product.displayExtras??[]).map(extra=>extra.id??''),note:line.product.note??''})),expected_total:getTotal(),contact_name:phoneName.trim(),contact_phone:phoneContact,customer_id:customerId,order_type:orderType,order_note:orderNote}};
          }
          beginPhoneRequest(localStorage,request);if(draftOwner.current===actor)setPhonePending(request);
        }
        const acknowledged=await submitPhoneRequest(supabase,localStorage,request!);
        // A save replay confirms its original snapshot, not today's payment
        // state. Keep recovery intact until the current shared order is read.
        const order=request!.kind==='save'?await getPhoneOrder(supabase,acknowledged.id):acknowledged;
        if(request!.kind==='save'){
          const latest=order.status==='pending'?rememberPhonePrint(localStorage,`mi_cafe_checkout_review:${actor}`,order):null;
          binding?.retireRequest(request!.request);
          if(draftOwner.current===actor){if(latest)setPhonePrintId(latest);setPhonePrintNotice('');setSavedPhone(order);setShowPhoneContact(false);setShowPhoneOrders(false);}
        }else if(draftOwner.current===actor){setPhonePrintNotice('');setSavedPhone(order);setShowPhoneOrders(false);}
        completePhoneRequest(localStorage,request!);
        if(draftOwner.current===actor){setPhonePending(null);setPhoneError('');}
        return true;
      }));
    }catch(error){if(draftOwner.current===actor){setPhoneError(errorMessage(error));try{setPhonePending(readPhoneRequest(localStorage,actor));}catch{/* Keep the unreadable operation blocked. */}}return false;}
    finally{if(draftOwner.current===actor){phoneInFlight.current=false;setPhoneBusy(false);}}
  };

  const handlePayPhone = async (order:PhoneOrder) => {
    if(checkoutInFlight.current||checkoutReview||phonePending||phoneBusy||phoneError||isClosingShift||!registerId)return;
    const actor=draftOwner.current,binding=cartDraft.current;
    setPhoneBusy(true);
    try {
      if(readPhoneRequest(localStorage,actor))throw new Error('Comprueba el pedido sin confirmar antes de cobrar.');
      const current=await getPhoneOrder(supabase,order.id);
      if(draftOwner.current!==actor||cartDraft.current!==binding)return;
      if(current.status!=='pending')throw new Error('Este pedido ya no está por cobrar. Actualiza la lista.');
      setSelectedPhoneOrder(current);setShowPhoneOrders(false);setPaymentMethod('Efectivo');setAmountReceivedMXN('');setAmountReceivedUSD('');setShowCheckoutModal(true);
    }catch(error){if(draftOwner.current===actor)alert(errorMessage(error));}finally{if(draftOwner.current===actor)setPhoneBusy(false);}
  };

  const handlePrintPhone = async (order:PhoneOrder) => {
    if(phoneBusy||isProcessingCheckout||isClosingShift||checkoutReview||phonePending)return false;
    const actor=draftOwner.current;setPhoneBusy(true);
    try {
      const current=await getPhoneOrder(supabase,order.id);
      if(draftOwner.current!==actor)return false;
      if(!canPrintPhoneOrder(current))throw new Error('Este pedido no admite una comanda nueva. Actualiza la lista.');
      const id=rememberPhonePrint(localStorage,`mi_cafe_checkout_review:${actor}`,current);
      setPhonePrintId(id);setSavedPhone(current);setPhonePrintNotice(`Pedido #${current.folio} · Comprueba el estado de impresión`);setShowPhoneOrders(false);
      return true;
    }catch(error){if(draftOwner.current===actor)alert(errorMessage(error));return false;}
    finally{if(draftOwner.current===actor)setPhoneBusy(false);}
  };

  const changeQuantity = (id: string, quantity: number) => {
    const line=items.find(i=>i.id===id),product=products.find(p=>p.id===line?.product.id);
    if (line && product && quantity>line.quantity) {
      const requested=items.filter(i=>i.product.id===product.id && i.id!==id).reduce((sum,i)=>sum+i.quantity,0)+quantity;
      if (!productAvailable(product) || (product.inventory?.mode==='counted' && product.inventory.quantity!==null && requested>product.inventory.quantity)) { alert('La cantidad supera las existencias disponibles.'); return; }
    }
    updateQuantity(id,quantity);
  };

  // Reimprime por folio o recupera el último ticket.
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
        if(selectedPhoneOrder&&existing&&existing.payload?.phone_order_id!==selectedPhoneOrder.id){setCheckoutReview(existing);setSelectedPhoneOrder(null);throw new Error('Hay otra venta sin confirmar. Compruébala antes de cobrar este pedido.');}
        wasRecovery = Boolean(existing);
        setIsProcessingCheckout(true);

        let review = existing;
        if (!review) {
          if(!smoothies&&!selectedPhoneOrder&&!validPagerNumber(pagerNumber)) throw new Error('Elige un control del 1 al 30 antes de cobrar.');
          if (!selectedPhoneOrder&&catalogStale) throw new Error('El menú cambió. Cierra el cobro, actualiza y revisa el pedido.');
          if (!selectedPhoneOrder&&(!binding || draftError || customerRestoring || (activeCustomer?.id ?? null) !== customerId))
            throw new Error('Revisa el pedido y el cliente antes de cobrar.');
          if(phonePending||phoneBusy||phoneError)throw new Error('Comprueba el pedido sin confirmar antes de cobrar.');
          if(readPhoneRequest(localStorage,draftOwner.current))throw new Error('Comprueba el pedido sin confirmar antes de cobrar.');
          const orderTotal = selectedPhoneOrder?.snapshot.total??getTotal(),orderItems=selectedPhoneOrder?.snapshot.items??items;
          if (!registerId || !orderItems.length || !Number.isFinite(orderTotal) || orderTotal <= 0 || isPaymentInsufficient) throw new Error('Revisa la orden, el turno y el importe recibido.');
          const cash = ['Efectivo','Mixto'].includes(paymentMethod);
          if (cash && !smoothies && !Number.isInteger(parseAmount(amountReceivedUSD))) throw new Error('Recibe dólares enteros. El cambio se entrega en pesos.');
          review = { startedAt: new Date().toISOString(), total: orderTotal, requestId: selectedPhoneOrder?crypto.randomUUID():binding!.requestId(),
            ...(clipEnabled && paymentMethod==='Tarjeta' ? {provider:'clip' as const} : {}),
            payload: checkoutPayload(orderItems, {
              register_id: registerId, expected_total: orderTotal, payment_method: paymentMethod.toLowerCase(),
              tender_mxn: cash ? parseAmount(amountReceivedMXN) : 0, tender_usd: cash ? parseAmount(amountReceivedUSD) : 0,
              customer_id: selectedPhoneOrder?selectedPhoneOrder.customer_id??null:customerId, order_type: selectedPhoneOrder?.snapshot.order_type??orderType, order_note: selectedPhoneOrder?.snapshot.order_note??orderNote, pager_number:selectedPhoneOrder||smoothies?null:pagerNumber,
              ...(selectedPhoneOrder?{phone_order_id:selectedPhoneOrder.id,phone_order_revision:selectedPhoneOrder.revision}:{}),
            }, !smoothies),
          };
          // Persist the exact identity and payload before the first request.
          writtenReview = JSON.stringify(review);
          localStorage.setItem(checkoutKey, writtenReview);
        }
        setCheckoutReview(review);
        if(review.payload?.phone_order_id){
          const phone=selectedPhoneOrder?.id===review.payload.phone_order_id?selectedPhoneOrder:await getPhoneOrder(supabase,review.payload.phone_order_id);
          if(canPrintPhoneOrder(phone))rememberPhonePrint(localStorage,checkoutKey,phone);
        }
        const order = await executeCheckout(supabase, review);
        const phonePayment=Boolean(review.payload?.phone_order_id);
        if (order.status === 'cancelled') {
          if(!phonePayment)binding?.complete();
          localStorage.removeItem(checkoutKey);
          if (!stillCurrent()) return;
          setCheckoutReview(null); if(!phonePayment)clearCart();setSelectedPhoneOrder(null); setShowCheckoutModal(false);
          alert('La venta fue cancelada por el responsable. No vuelvas a cobrarla; revisa cualquier devolución de dinero.');
          return;
        }
        if (order.status !== 'completed') throw new Error('El estado de esta venta requiere revisión del responsable.');
        // Save the print intent before retiring checkout recovery. Retrying uses the same sale.
        rememberSalePrint(localStorage, checkoutKey, order);
        if(!phonePayment)binding?.complete(); // A phone payment must preserve the cashier's separate draft.
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
      else if (!(error instanceof ClipPaymentPending)) alert(error instanceof Error ? errorMessage(error) : 'No se confirmó la venta.');
    } finally {
      if (stillCurrent()) { checkoutInFlight.current = false; setIsProcessingCheckout(false); }
    }
  };

  const handleDiscardCheckout = async () => {
    if (checkoutInFlight.current || !checkoutReviewKey.current || !checkoutReview?.requestId) return;
    if (!confirm('¿Quitar este pedido pendiente? Solo se quitará si no se registró la venta. Revisa antes el dinero recibido.')) return;
    const checkoutKey = checkoutReviewKey.current, binding = cartDraft.current;
    const stillCurrent = () => checkoutKey === checkoutReviewKey.current && binding === cartDraft.current;
    checkoutInFlight.current = true;
    setIsProcessingCheckout(true);
    try {
      await withCheckoutLock(checkoutKey, async () => {
        if (!stillCurrent()) return;
        const { error } = await withDeadline(() => supabase.rpc('pos_abandon_checkout', { p_request: checkoutReview.requestId }));
        if (error) throw new Error(errorMessage(error));
        if(!checkoutReview.payload?.phone_order_id)binding?.complete();
        localStorage.removeItem(checkoutKey);
        if (!stillCurrent()) return;
        setCheckoutReview(null); if(!checkoutReview.payload?.phone_order_id)clearCart();setSelectedPhoneOrder(null); setShowCheckoutModal(false);
      });
    } catch (error) { if (stillCurrent()) alert(error instanceof Error ? errorMessage(error) : 'No se pudo quitar el pedido. Revisa la venta pendiente.'); }
    finally { if (stillCurrent()) { checkoutInFlight.current = false; setIsProcessingCheckout(false); } }
  };

  const handleClearOrder = () => {
    clearCart(); setActiveCustomer(null); setCustomerId(null); setCustomerRestoring(false); setCustomerError(null);
    customerSearchRevision.current++; setCustomerSearch(''); setCustomerSuggestions([]); setCustomerSearchError('');setCustomerSearching(false);
  };

  const handleNextOrder = () => {
    if(savedSale?.phone_order_id){setSavedSale(null);setShowPostSaleModal(false);setSelectedPhoneOrder(null);return;}
    setSavedSale(null);
    setShowPostSaleModal(false);
    clearCart();
    setActiveCustomer(null);
    fetchData();
  };

  const filteredProducts = appearance === 'owner' ? cards.filter(p => matchesMenuCard(p, searchTerm)) : [];
  const groupedProducts = filteredProducts.reduce<Record<string, MenuCard[]>>((acc, p) => {
    const cat = p.category || "Sin Categoría";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  // 🟢 LA MATEMÁTICA PROTEGIDA DEL CAMBIO
  const totalReceivedCombinedMXN = receivedCashMXN(parseAmount(amountReceivedMXN),parseAmount(amountReceivedUSD),parseAmount(exchangeRate));
  const checkoutTotal=selectedPhoneOrder?.snapshot.total??getTotal();
  const isPaymentInsufficient = (paymentMethod === 'Efectivo' || paymentMethod === 'Mixto') && (totalReceivedCombinedMXN < checkoutTotal || (!smoothies && !Number.isInteger(parseAmount(amountReceivedUSD))));

  const catalogNotice = (catalogStale || catalogCheckError) && <div role="status" className="relative z-10 flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-950"><span>{catalogStale ? 'El menú cambió. Actualiza y revisa el pedido antes de cobrar.' : catalogCheckError} {(selectedFamily || selectedProduct || showCheckoutModal) && 'Cierra la ventana actual para actualizar.'}{checkoutReview && 'Primero resuelve la venta pendiente.'}</span><button type="button" className="rounded-xl border bg-white px-4 py-2 font-semibold disabled:opacity-50" disabled={loading || !!selectedFamily || !!selectedProduct || showCheckoutModal || !!checkoutReview || isProcessingCheckout || isClosingShift || savingExpense || openingShift} onClick={refreshCatalog}>Actualizar menú</button></div>;
  const printStatus = <PrintDispatch key={printCheckoutKey} checkoutKey={printCheckoutKey} latestOrderId={savedSale?.id??phonePrintId} />;
  const RegisterView = appearance === 'workspace' ? WorkspaceRegister : PrototypeRegister;
  const CheckoutView = appearance === 'workspace' ? WorkspaceCheckout : PrototypeCheckout;
  const PaymentView=selectedPhoneOrder?WorkspaceCheckout:CheckoutView;
  const customizationProps = {
    steps: dynamicSteps, index: customizationStep, extras: activeExtras,
    dbExtras: selectedProduct ? dbExtras.filter(e => e.active && extraAppliesToProduct(e, selectedProduct.id)) : [],
    note: productNote, onNote: setProductNote, onStep: setCustomizationStep,
    onOption: chooseExtra, onConfirm: handleConfirmAdd, onClose: closeCustomization,
  };
  const drawerBlocked = Boolean(showApertura && drawer && (drawer.handoff || (drawer.active && drawer.active.cashier_id !== drawerActor) || (!smoothies && drawer.rate === null)));
  const phoneNotice=<>{(phonePending||phoneError)&&<div role="alert" className="phone-order-notice"><div><strong>{phonePending?'Pedido sin confirmar':'Revisa el pedido'}</strong><span>{phoneError||'Comprueba si se guardó antes de volver a enviarlo.'}</span></div>{phonePending&&<button type="button" disabled={phoneBusy||isProcessingCheckout} onClick={()=>void handlePhoneRequest(true)}>Comprobar pedido</button>}{!phonePending&&<button type="button" onClick={()=>void fetchData()}>Revisar pedido</button>}</div>}{savedPhone&&<div role="status" className="phone-order-notice"><span>{phonePrintNotice||(savedPhone.status==='paid'?`Pedido #${savedPhone.folio} pagado`:savedPhone.status==='cancelled'?`Pedido #${savedPhone.folio} cancelado. Avisa a barra.`:`Pedido #${savedPhone.folio} guardado · Sin pagar`)}</span><button type="button" onClick={()=>{setSavedPhone(null);setShowPhoneOrders(true);}}>Ver pedidos</button><button type="button" aria-label="Cerrar aviso de pedido guardado" onClick={()=>setSavedPhone(null)}>×</button></div>}</>;

  return (
    <div className={`flex h-screen bg-[#F5F5F7] text-[#1D1D1F] font-sans antialiased overflow-hidden ${appearance==='workspace'?'pos-workspace':appearance==='prototype'?'pos-prototype':''}`}>
      {showPhoneContact&&<PhoneOrderContact name={phoneName} phone={phoneContact} total={getTotal()} orderType={orderType} onOrderType={setOrderType} busy={phoneBusy} pending={!!phonePending} onRecover={()=>void handlePhoneRequest(true)} error={phoneError} onName={setPhoneName} onPhone={setPhoneContact} onSave={()=>void handlePhoneRequest()} onClose={()=>setShowPhoneContact(false)}/>}
      {showPhoneOrders&&<PhoneOrders client={supabase} disabled={isProcessingCheckout||isClosingShift||phoneBusy||!!phonePending||!!checkoutReview||!registerId} pending={!!phonePending} pendingError={phoneError} onRecover={()=>handlePhoneRequest(true)} onClose={()=>setShowPhoneOrders(false)} onPay={order=>void handlePayPhone(order)} onPrint={handlePrintPhone} onCancel={(order,reason,returns)=>handlePhoneRequest(false,{order,reason,returns})}/>}

      {/* MODAL: APERTURA DE TURNO */}
      {drawerBlocked && drawer && <DrawerGate client={supabase} status={drawer} actor={drawerActor} isAdmin={isAdmin} reload={fetchData} logout={()=>void handleLogout()}/>}
      {showApertura && !drawerBlocked && appearance==='workspace' && <WorkspaceOpening pesosOnly={smoothies} userName={userName} isAdmin={isAdmin} denominations={DENOMINATIONS} counts={breakdown} onCounts={setBreakdown}
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
                  Abrir caja <span className="text-[#0071e3] block">{userName}</span>
                </h2>
                <p className="text-slate-400 text-xs font-medium leading-relaxed">Cuenta el efectivo inicial y revisa el tipo de cambio guardado.</p>
              </div>
              {appearance==='prototype'?<div className="flex flex-col gap-3">
                {isAdmin&&<a href="/admin" className="text-white underline">Administrar sin abrir caja</a>}
                <button onClick={()=>void handleLogout()} className="text-white border border-white/40">Cambiar usuario</button>
              </div>:<div className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">{posProfile.brand}</div>}
            </div>

            <div className="flex-1 p-8 flex flex-col justify-between max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-6 mb-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest px-1">Tipo de cambio guardado (MXN/USD)</label>
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
      {closeCheck && <WorkspaceDialog title="Cierre por comprobar">
        <div className="workspace-dialog-content">
          <p>Comprueba el estado del corte antes de abrir otro turno.</p>
          {closeCheck.error && <p role="alert">{closeCheck.error}</p>}
        </div>
        <footer><button type="button" className="workspace-primary" disabled={isClosingShift} onClick={() => void handleVerifyClose()}>
          {isClosingShift ? 'Comprobando…' : 'Comprobar cierre'}
        </button></footer>
      </WorkspaceDialog>}
      {savedExit && <WorkspaceDialog title={savedExit === 'handoff' ? 'Entrega guardada' : 'Caja cerrada'} className="pos-shift-closed">
        <div className="workspace-dialog-content">
          <p>{savedExit === 'handoff' ? 'El siguiente cajero debe entrar y confirmar el efectivo recibido.' : 'El corte se guardó. Puedes abrir otro turno con tu cuenta.'}</p>
          {preparingNextShift ? <p role="status">Consultando el estado de la caja…</p> : loadError && <p role="alert">{loadError}</p>}
          {logoutError && <p role="alert">No se pudo cerrar la sesión. Revisa la conexión y vuelve a intentar.</p>}
        </div>
        <footer>
          <button type="button" disabled={signingOut || preparingNextShift} onClick={() => void handleLogout()}>{signingOut ? 'Cerrando sesión…' : logoutError ? 'Reintentar salir' : 'Cerrar sesión'}</button>
          {savedExit === 'close' && <button type="button" className="workspace-primary" disabled={signingOut || preparingNextShift}
            onClick={() => void handlePrepareNextShift()}>Abrir nuevo turno</button>}
        </footer>
      </WorkspaceDialog>}
      {showCierre && (
        <WorkspaceDialog title="Cierre de caja" busy={isClosingShift} onClose={() => setShowCierre(false)} className="pos-closing-dialog">
          <div className="pos-closing-main">

             {/* PANEL IZQUIERDO: RESUMEN Y MATEMÁTICA */}
             <div className="pos-closing-summary">
                <div className="space-y-4">
                  <h2 className="text-2xl font-semibold tracking-tighter mb-4">Resumen del Turno</h2>

                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center bg-white/5 p-3 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Fondo inicial</span>
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
                      <p className="text-[10px] uppercase font-black tracking-widest mb-1 text-slate-500">Efectivo esperado</p>
                      <p className="text-3xl font-black text-white tracking-tighter">${expectedCash.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                   {!smoothies && <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">1 USD = <span className="text-white">{exchangeRate} MXN</span></p>}
                   <button onClick={handleLogout} disabled={savingExpense || isClosingShift} className="flex items-center gap-2 text-red-400 font-bold hover:text-red-300 transition-colors text-sm">
                     <LogOut size={18}/> Salir y dejar mi turno abierto
                   </button>
                </div>
             </div>

             {/* PANEL DERECHO: GASTOS Y ARQUEO */}
             <div className="pos-closing-content">

                <fieldset className="pos-closing-operation" disabled={isClosingShift}>
                  <legend>¿Qué harás con la caja?</legend>
                  <div className="pos-closing-options">
                    <button type="button" aria-pressed={closeAction==='close'} onClick={() => { setCloseAction('close'); setHandoffTarget(''); setCountConfirmed(false); }}>Cerrar caja</button>
                    <button type="button" aria-pressed={closeAction==='handoff'} onClick={() => { setCloseAction('handoff'); setCountConfirmed(false); }}>Entregar a otro cajero</button>
                  </div>
                </fieldset>
                {closeAction==='handoff' && <fieldset className="pos-closing-recipients" disabled={isClosingShift}>
                  <legend>Recibirá la caja</legend>
                  <div className="pos-closing-options">{drawer?.cashiers.map(c => <button type="button" key={c.id} aria-pressed={handoffTarget===c.id} onClick={() => { setHandoffTarget(c.id); setCountConfirmed(false); }}>{c.name}</button>)}</div>
                  <p>{drawer?.cashiers.length ? 'El cajero elegido deberá iniciar sesión para recibir la caja.' : 'No hay otro cajero disponible para recibir la caja.'}</p>
                </fieldset>}

                {/* SECCIÓN GASTOS */}
                <div className="bg-[#f5f5f7] p-4 rounded-[20px] border border-slate-100 mb-4">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-2.5">Retiro de efectivo</label>
                  <div className="flex gap-2">
                    <input type="text" aria-label="Concepto del gasto" placeholder="Ej. Garrafón de agua..." disabled={isClosingShift} className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold outline-none focus:border-[#0071e3]/30 transition-all" value={newExpense.desc} onChange={e => setNewExpense({...newExpense, desc: e.target.value})} />
                    <input type="number" inputMode="decimal" aria-label="Importe del gasto" placeholder="$0.00" disabled={isClosingShift} className="w-24 flex-shrink-0 bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-semibold outline-none focus:border-[#0071e3]/30 text-right transition-all" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: e.target.value})} />
                    <button aria-label="Registrar gasto" onClick={handleAddExpense} disabled={savingExpense || isClosingShift || !!expenseError} className="bg-[#1d1d1f] flex-shrink-0 text-white w-14 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><Plus size={20}/></button>
                  </div>

                  {expenseError && <p role="alert" className="text-sm text-red-600 mt-2">{expenseError} <button className="underline" onClick={() => { setShowCierre(false); void fetchData(); }}>Reintentar conexión</button></p>}
                  {/* LISTA DE GASTOS */}
                  {expenses.length > 0 && (
                    <div className="flex flex-wrap gap-2 max-h-[60px] overflow-y-auto custom-scrollbar pt-3 mt-3 border-t border-slate-200/60">
                      {expenses.map((exp, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-semibold text-slate-600">{exp.desc}</span>
                          <span className="text-[11px] font-black text-red-500">-${exp.amount.toFixed(2)}</span>
                          <button aria-label={`Quitar gasto: ${exp.desc}`} onClick={() => { void handleRemoveExpense(i); }} disabled={savingExpense || isClosingShift || !!expenseError} className="text-slate-500 hover:text-red-500 transition-colors ml-1"><X size={20}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ARQUEO DE EFECTIVO */}
                <div className="mb-4">
                  <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest px-1 block mb-2">Efectivo contado</label>
                  <div className="grid grid-cols-3 gap-3">
                    {DENOMINATIONS.map((den) => (
                      <div key={den} className="relative group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400 group-focus-within:text-[#0071e3] transition-colors">${den}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          aria-label={`Piezas de ${den} pesos al cierre`}
                          disabled={isClosingShift}
                          min="0"
                          placeholder="0"
                          className="w-full bg-white border-2 border-slate-100 rounded-xl py-2 pl-10 pr-3 text-right text-base font-black outline-none focus:border-[#0071e3]/30 transition-all shadow-sm"
                          value={breakdown[den] === 0 ? '' : breakdown[den]}
                          onChange={(e) => { setBreakdown({ ...breakdown, [den]: e.target.value === '' ? 0 : Number(e.target.value) }); setCountConfirmed(false); }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* TOTALES */}
                <div className="p-4 bg-[#f5f5f7] rounded-[24px] border border-slate-100 mb-5 mt-auto">
                   {!smoothies && <div className="flex justify-between items-center mb-3">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Dólares en caja</span>
                      <div className="relative w-32">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input
                          type="number"
                          inputMode="decimal"
                          aria-label="Dólares finales"
                          disabled={isClosingShift}
                          placeholder="0"
                          className="w-full bg-white border border-slate-200 focus:border-[#0071e3]/40 rounded-xl py-2 pl-9 pr-3 text-right text-sm font-black outline-none transition-all shadow-sm"
                          value={dollarsInBox}
                          onChange={(e) => { setDollarsInBox(e.target.value === '' ? '' : Number(e.target.value)); setCountConfirmed(false); }}
                        />
                      </div>
                   </div>}

                   <div className="flex justify-between items-center border-t border-slate-200 pt-3">
                      <span className="text-[11px] font-black tracking-widest uppercase text-[#86868b]">Total contado</span>
                      <div className="flex items-center gap-3">
                         <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-wider ${difference === 0 ? 'bg-green-100 text-green-700' : difference > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                           {difference === 0 ? 'Caja Cuadrada' : difference > 0 ? `Sobrante +$${difference.toFixed(2)}` : `Faltante -$${Math.abs(difference).toFixed(2)}`}
                         </span>
                         <span className="text-2xl font-black text-[#1d1d1f] tracking-tighter">${countedCash.toFixed(2)}</span>
                      </div>
                   </div>
                </div>

             </div>
          </div>
          <footer className="pos-closing-footer">
                <label className="pos-closing-confirm"><input type="checkbox" checked={countConfirmed} disabled={isClosingShift} onChange={e=>setCountConfirmed(e.target.checked)}/><span>Terminé de contar. Confirmo <strong>${countedCash.toFixed(2)} MXN</strong>{countedCash===0 ? ' (caja en cero)' : ''}.</span></label>
                <div className="pos-closing-actions">
                  <button disabled={isClosingShift} onClick={() => setShowCierre(false)} className="flex-1 bg-slate-100 text-slate-600 h-14 rounded-[20px] font-bold hover:bg-slate-200 transition-all disabled:opacity-50">
                    Volver a caja
                  </button>
                  <button onClick={handleSaveAndClose} disabled={!countConfirmed || items.length>0 || isClosingShift || savingExpense || !!expenseError || (closeAction==='handoff'&&(!handoffTarget||items.length>0))} className="flex-1 bg-[#1d1d1f] text-white h-14 rounded-[20px] font-bold shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex justify-center items-center gap-2 disabled:opacity-50">
                    <Printer size={20} /> {isClosingShift ? 'Guardando…' : closeAction==='handoff' ? 'Confirmar entrega' : 'Confirmar cierre'}
                  </button>
                </div>
          </footer>
        </WorkspaceDialog>
      )}

      {appearance!=='owner' ? <RegisterView products={products} items={items} total={getTotal()} search={searchTerm} onSearch={setSearchTerm}
        favoriteProductIds={favoriteProductIds} favoritesError={favoritesError} favoritesLoading={favoritesLoading} onRetryFavorites={()=>{setFavoritesLoading(true);setFavoritesError('');setFavoritesAttempt(value=>value+1);}}
        recentTicketsContent={<RecentTickets key={drawerActor} onReprint={ticket=>void reprintHistoricalTicket(ticket)} disabled={isProcessingCheckout || isClosingShift}/>}
        userName={userName} isAdmin={isAdmin} disabled={loading||!!loadError||!!draftError||!!customerError||customerRestoring||!!checkoutReview||isClosingShift||isProcessingCheckout||phoneBusy||!!phonePending||!!phoneError}
        {...(appearance === 'workspace' ? { catalogLoading: loading, weeklySpecialId, smoothies } : {})}
        onProduct={handleMenuCardClick} onEdit={handleEditItem} onQuantity={changeQuantity} onRemove={removeItem} onClear={handleClearOrder} onCheckout={handleOpenCheckout} onCloseShift={()=>void handleOpenCierre()}
        onHandoff={()=>void handleOpenCierre('handoff')}
        customerSearchError={customerSearchError} customerSearching={customerSearching} onRetryCustomerSearch={()=>void handleCustomerSearchInput(customerSearch)} customer={activeCustomer} customerSearch={customerSearch} onCustomerSearch={handleCustomerSearchInput} suggestions={customerSuggestions} onCustomer={selectCustomer}
        onNewCustomer={handleOpenCustomerModal} onRemoveCustomer={()=>{setCustomerId(null);setActiveCustomer(null);setCustomerRestoring(false);setCustomerError(null);}}
        orderType={orderType} onOrderType={setOrderType} orderNote={orderNote} onOrderNote={setOrderNote} pagerNumber={pagerNumber} onPagerNumber={smoothies?undefined:setPagerNumber} phoneOrder={phoneOrder} onPhoneOrder={()=>{setPhoneOrder(true);if(items.length)setShowPhoneContact(true);}} onPhoneOrders={smoothies?undefined:()=>setShowPhoneOrders(true)} onReprint={ticket=>void reprintHistoricalTicket(ticket)} notices={<>
        {phoneNotice}
        {catalogNotice}
        {!showPostSaleModal && printStatus}
        {loadError && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo cargar el catálogo. {loadError}</p>
            <button onClick={() => { void fetchData(); }} className="mt-2 font-semibold underline">Reintentar conexión</button>
          </div>
        )}
        {(draftError || customerError) && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo cargar o guardar el pedido. {draftError || customerError}</p>
            <div className="mt-2 flex gap-4">
              <button className="font-semibold underline" onClick={async () => {
                try {
                  if (cartDraft.current && !cartDraft.current.conflicted && !customerError) { cartDraft.current.flush(); setDraftError(null); }
                  else await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Revisar pedido</button>
              {customerError && <button className="font-semibold underline" onClick={() => {
                setCustomerId(null); setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null);
              }}>Quitar cliente</button>}
              <button className="font-semibold underline" onClick={async () => {
                if (!draftStorageKey.current || !confirm('¿Vaciar este pedido? Si hay un cobro sin confirmar, tendrás que revisarlo antes de cobrar de nuevo.')) return;
                try {
                  localStorage.removeItem(draftStorageKey.current);
                  cartDraft.current?.disconnect(); cartDraft.current = null;
                  clearCart(); await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Vaciar pedido</button>
            </div>
          </div>
        )}
        {checkoutReview && !isProcessingCheckout && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Venta sin confirmar{checkoutReview.ticketNumber != null ? ` · Folio ${checkoutReview.ticketNumber}` : ''}</p>
            <p>No vuelvas a cobrar al cliente. Comprueba esta venta antes de continuar.</p>
            <p>Importe: ${checkoutReview.total.toFixed(2)} · Inicio: {checkoutReview.startedAt}</p>
            {checkoutReview.requestId && checkoutReview.payload && <button type="button" className="mt-2 min-h-11 rounded-xl bg-[#0066cc] px-4 py-2 font-semibold text-white" onClick={processCheckout}>Comprobar venta</button>}
            {checkoutReview.provider==='clip' && checkoutReview.requestId && <ClipPaymentStatus requestId={checkoutReview.requestId} onReady={() => void processCheckout()}/>}
            <div className="mt-2 flex gap-4">
              <a href="/admin/ventas" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Revisar historial</a>
              {checkoutReview.requestId && <button className="font-semibold underline" onClick={handleDiscardCheckout}>Quitar pedido pendiente</button>}
              {!checkoutReview.requestId && <button className="font-semibold underline" onClick={() => {
                if (!confirm('¿El responsable ya revisó esta venta? Se vaciará el pedido para evitar cobrarlo de nuevo.')) return;
                try {
                  cartDraft.current?.complete();
                  localStorage.removeItem(checkoutReviewKey.current);
                  clearCart();
                  setShowCheckoutModal(false);
                  setCheckoutReview(null);
                } catch { alert('No se pudo guardar la revisión. El cobro sigue pendiente.'); }
              }}>El responsable ya la revisó</button>}
            </div>
          </div>
        )}
        </>}/> : <>
      {/* POS PRINCIPAL */}
      <div className="flex-1 flex flex-col p-8 overflow-hidden">
        {phoneNotice}<button type="button" className="workspace-tickets" onClick={()=>setShowPhoneOrders(true)}>Pedidos por cobrar</button>
        {catalogNotice}
        {!showPostSaleModal && printStatus}
        {loadError && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo cargar el catálogo. {loadError}</p>
            <button onClick={() => { void fetchData(); }} className="mt-2 font-semibold underline">Reintentar conexión</button>
          </div>
        )}
        {(draftError || customerError) && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p>No se pudo cargar o guardar el pedido. {draftError || customerError}</p>
            <div className="mt-2 flex gap-4">
              <button className="font-semibold underline" onClick={async () => {
                try {
                  if (cartDraft.current && !cartDraft.current.conflicted && !customerError) { cartDraft.current.flush(); setDraftError(null); }
                  else await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Revisar pedido</button>
              {customerError && <button className="font-semibold underline" onClick={() => {
                setCustomerId(null); setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null);
              }}>Quitar cliente</button>}
              <button className="font-semibold underline" onClick={async () => {
                if (!draftStorageKey.current || !confirm('¿Vaciar este pedido? Si hay un cobro sin confirmar, tendrás que revisarlo antes de cobrar de nuevo.')) return;
                try {
                  localStorage.removeItem(draftStorageKey.current);
                  cartDraft.current?.disconnect(); cartDraft.current = null;
                  clearCart(); await fetchData();
                } catch (error) { setDraftError(errorMessage(error)); }
              }}>Vaciar pedido</button>
            </div>
          </div>
        )}
        {checkoutReview && !isProcessingCheckout && (
          <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Venta sin confirmar{checkoutReview.ticketNumber != null ? ` · Folio ${checkoutReview.ticketNumber}` : ''}</p>
            <p>No vuelvas a cobrar al cliente. Comprueba esta venta antes de continuar.</p>
            <p>Importe: ${checkoutReview.total.toFixed(2)} · Inicio: {checkoutReview.startedAt}</p>
            {checkoutReview.requestId && checkoutReview.payload && <button type="button" className="mt-2 min-h-11 rounded-xl bg-[#0066cc] px-4 py-2 font-semibold text-white" onClick={processCheckout}>Comprobar venta</button>}
            <div className="mt-2 flex gap-4">
              <a href="/admin/ventas" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Revisar historial</a>
              {checkoutReview.requestId && <button className="font-semibold underline" onClick={handleDiscardCheckout}>Quitar pedido pendiente</button>}
              {!checkoutReview.requestId && <button className="font-semibold underline" onClick={() => {
                if (!confirm('¿El responsable ya revisó esta venta? Se vaciará el pedido para evitar cobrarlo de nuevo.')) return;
                try {
                  cartDraft.current?.complete();
                  localStorage.removeItem(checkoutReviewKey.current);
                  clearCart();
                  setShowCheckoutModal(false);
                  setCheckoutReview(null);
                } catch { alert('No se pudo guardar la revisión. El cobro sigue pendiente.'); }
              }}>El responsable ya la revisó</button>}
            </div>
          </div>
        )}
        <header className="mb-8 flex justify-between items-center">
          <div>
            <Image src="/receipt-branding/carinito-logo-v1.jpg" width={40} height={40} unoptimized alt={posProfile.brand} className="h-10 w-10 rounded-full object-cover" />
          </div>

          <div className="flex items-center gap-4">

            {/* Reimpresión por folio. */}
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
              <input type="text" placeholder="Buscar producto" value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="w-full bg-white border border-slate-200 rounded-[20px] py-3.5 pl-12 pr-4 outline-none text-sm font-medium focus:ring-4 focus:ring-[#0071e3]/10 transition-all" />
            </div>

            <button onClick={()=>void handleOpenCierre('handoff')} className="border rounded-xl px-4">Cambiar cajero</button>
            <button onClick={()=>void handleOpenCierre()} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 px-4 py-3.5 rounded-[20px] hover:bg-slate-50 hover:text-red-500 transition-all font-semibold text-sm shadow-sm">
              <LogOut size={18} /> Terminar Turno
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto space-y-12 pr-4 custom-scrollbar" role="region" aria-label="Productos del menú" tabIndex={0}>
          {Object.keys(groupedProducts).sort().map(cat => (
            <section key={cat}>
              <h2 className="text-[11px] font-black uppercase text-slate-400 mb-5 px-2 tracking-[0.2em]">{cat}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {groupedProducts[cat].map((p) => (
                  <button type="button" key={p.id} disabled={!menuCardAvailable(p)} onClick={() => handleMenuCardClick(p)} className="bg-white text-left rounded-[2.5rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-xl transition-all cursor-pointer group border border-transparent hover:border-blue-50 disabled:opacity-50">
                    <div className="h-32 bg-slate-50 rounded-[20px] mb-4 overflow-hidden relative">
                      <ProductPhoto product={p} width={512} height={512} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    </div>
                    <h3 className="font-bold text-sm text-slate-800">{p.name}</h3>{productStockLabel(p) && <small>{productStockLabel(p)}</small>}
                    <p className="text-[#0071e3] font-black text-sm mt-1">{menuCardPrice(p)}</p>
                  </button>
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
                    placeholder="Teléfono del cliente"
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
                  <p className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider">Cliente</p>
                  <h4 className="font-semibold text-sm truncate w-40">{activeCustomer.name}</h4>
                  <p className="text-[11px] font-semibold text-[#0071e3]">{activeCustomer.points} puntos acumulados</p>
                </div>
                <button onClick={() => { setCustomerId(null); setActiveCustomer(null); setCustomerRestoring(false); setCustomerError(null); }} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"><X size={14} /></button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 px-8 overflow-y-auto py-6 space-y-4" role="region" aria-label="Artículos del pedido" tabIndex={0}>
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
                      <button onClick={() => changeQuantity(item.id, item.quantity - 1)} className="p-1 hover:text-[#0071e3] text-slate-400 transition-colors"><Minus size={14}/></button>
                      <span className="font-bold text-[13px] w-5 text-center text-[#1d1d1f]">{item.quantity}</span>
                      <button onClick={() => changeQuantity(item.id, item.quantity + 1)} className="p-1 hover:text-[#0071e3] text-slate-400 transition-colors"><Plus size={14}/></button>
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
          <PagerPicker value={pagerNumber} onChange={setPagerNumber} phoneOrder={phoneOrder} onPhoneOrder={()=>{setPhoneOrder(true);if(items.length)setShowPhoneContact(true);}} disabled={loading || !!checkoutReview || isProcessingCheckout || isClosingShift||phoneBusy||!!phonePending}/>
          {!validPagerNumber(pagerNumber)&&!phoneOrder&&items.length>0&&<p className="pos-pager-required-note">Elige un control para cobrar.</p>}
          <div className="flex justify-between items-baseline">
            <span className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight">Total</span>
            <span className="text-4xl font-semibold text-[#1d1d1f] tracking-tighter">${getTotal().toFixed(2)}</span>
          </div>
          <button onClick={handleOpenCheckout} disabled={items.length === 0 || (!phoneOrder&&!validPagerNumber(pagerNumber)) || loading || !!loadError || !!draftError || !!customerError || customerRestoring || !!checkoutReview || isClosingShift||phoneBusy||!!phonePending||!!phoneError} className="w-full bg-[#0071e3] text-white h-16 rounded-[22px] font-semibold text-lg shadow-xl shadow-blue-100 hover:bg-[#0077ed] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none">
             <CreditCard size={22}/> {phoneOrder?'Guardar pedido':'Pagar Ahora'}
          </button>
        </div>
      </div>

      </>}
      {showCheckoutModal&&(appearance!=='owner'||selectedPhoneOrder)&&<PaymentView total={checkoutTotal} method={paymentMethod} mxn={amountReceivedMXN} usd={amountReceivedUSD} exchangeRate={parseAmount(exchangeRate)}
        pagerNumber={selectedPhoneOrder?null:pagerNumber} onPagerNumber={selectedPhoneOrder||smoothies?undefined:setPagerNumber} smoothies={smoothies} clipEnabled={clipEnabled} phoneOrderLabel={selectedPhoneOrder?`Pedido por teléfono #${selectedPhoneOrder.folio} · ${selectedPhoneOrder.contact_name}`:undefined}
        orderType={selectedPhoneOrder?.snapshot.order_type??orderType} note={selectedPhoneOrder?.snapshot.order_note??orderNote} busy={isProcessingCheckout} insufficient={isPaymentInsufficient} onMethod={method=>{if(method===paymentMethod)return;setPaymentMethod(method);setAmountReceivedMXN('');setAmountReceivedUSD('');}}
        onMXN={setAmountReceivedMXN} onUSD={setAmountReceivedUSD} onOrderType={selectedPhoneOrder?()=>{}:setOrderType} onNote={selectedPhoneOrder?()=>{}:setOrderNote} onConfirm={()=>void processCheckout()} onClose={()=>{setShowCheckoutModal(false);setSelectedPhoneOrder(null);}}/>}
      {(selectedFamily || (appearance === 'workspace' && selectedProduct)) && <WorkspaceCustomization
        {...customizationProps} product={selectedProduct} family={selectedFamily} onVariant={handleVariant}
        smoothies={smoothies && !editingItemId && selectedProduct && isSmoothie(selectedProduct) ? cards.filter(isSmoothie) : undefined}
        onSmoothie={id => { const card = cards.find(product => product.id === id && isSmoothie(product)); if (card) handleMenuCardClick(card); }}
        quantity={editingItemId ? editingQuantity : undefined} onQuantity={setEditingQuantity}
        onRemove={editingItemId ? () => { removeItem(editingItemId); closeCustomization(); } : undefined} />}
      {!selectedFamily && selectedProduct && appearance === 'prototype' && <PrototypeCustomization
        {...customizationProps} product={selectedProduct} />}
      {/* 🟢 CHECKOUT DIVIDIDO EN 2 PASOS */}
      {showCheckoutModal && appearance==='owner'&&!selectedPhoneOrder && (
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
                 <PagerPicker value={pagerNumber} onChange={setPagerNumber} disabled={isProcessingCheckout}/>
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
                        placeholder="Ej. Mesa 4, para llevar"
                        className="w-full h-32 bg-[#f5f5f7] border-2 border-transparent focus:border-[#0071e3]/30 rounded-[16px] p-4 text-[15px] font-medium outline-none resize-none text-slate-700 transition-colors"
                      />
                    </div>
                 </div>
                 <button onClick={() => { if(validPagerNumber(pagerNumber)) setCheckoutStep(2); }} disabled={!validPagerNumber(pagerNumber)} className="w-full bg-[#0071e3] text-white h-16 rounded-[20px] font-bold text-lg flex justify-center items-center gap-2 shadow-xl hover:bg-[#0077ed] active:scale-95 transition-all disabled:opacity-50">
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
                      <span className={smoothies?'text-[10px] font-bold text-slate-400 uppercase tracking-widest':'text-[11px] font-bold text-slate-500 uppercase tracking-widest'}>{smoothies?'Equivalente USD':'Total USD'}</span>
                      <span className={smoothies?'text-lg font-black text-slate-400':'text-4xl font-black tracking-tighter text-[#1d1d1f]'}>${usdCashQuote(getTotal(),parseAmount(exchangeRate))?.usd ?? '—'}</span>
                    </div>
                 </div>

                 <div className="mb-6">
                    <label className="text-[10px] font-black uppercase text-[#86868b] tracking-widest block mb-3">Método de Pago</label>
                    <div className="grid grid-cols-3 gap-3">
                      {['Efectivo', 'Mixto', 'Tarjeta'].map(method => (
                         <button key={method} onClick={() => {
                              setPaymentMethod(method);
                              if (method === 'Tarjeta' || method === 'Otro') { setAmountReceivedMXN(getTotal()); setAmountReceivedUSD(''); }
                              else { setAmountReceivedMXN(''); setAmountReceivedUSD(''); }
                            }} className={`p-3.5 rounded-xl border-2 font-bold text-sm transition-all ${paymentMethod === method ? 'border-[#0071e3] text-[#0071e3] bg-blue-50/50' : 'border-slate-100 text-slate-600 hover:border-blue-200 bg-white'}`}>
                            {method === 'Mixto' ? 'MXN + USD' : method}
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
                        <input type="number" min="0" step="1" disabled={paymentMethod === 'Tarjeta' || paymentMethod === 'Otro'} value={amountReceivedUSD} onChange={e => {if(/^\d{0,8}$/.test(e.target.value))setAmountReceivedUSD(e.target.value);}} placeholder="0" className="w-full bg-[#f5f5f7] border-2 border-transparent focus:border-[#0071e3]/30 rounded-[16px] py-3.5 pl-14 pr-3 text-lg font-black outline-none disabled:opacity-60 text-right"/>
                      </div>
                    </div>

                    {/* BLOQUE DE CAMBIO EN VERDE */}
                    {((paymentMethod === 'Efectivo' || paymentMethod === 'Mixto') && totalReceivedCombinedMXN >= getTotal()) && (
                      <div className="flex flex-col gap-2 bg-[#06c167]/10 p-4 rounded-xl mt-4 animate-in fade-in border border-[#06c167]/20">
                         <div className="flex justify-between items-center">
                           <span className="text-xs font-bold text-[#06c167] uppercase tracking-wider">{smoothies?'Cambio (MXN):':'Cambio'}</span>
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

                 <button onClick={processCheckout} disabled={isProcessingCheckout || isPaymentInsufficient || !validPagerNumber(pagerNumber)} className="w-full bg-[#1d1d1f] text-white h-16 rounded-[20px] font-bold text-lg flex justify-center items-center gap-2 shadow-xl hover:bg-black active:scale-95 transition-all">
                    {isProcessingCheckout ? <Loader2 className="animate-spin" /> : <><CheckCircle2 size={22}/> Confirmar pago</>}
                 </button>
               </div>
             )}
          </div>
        </div>
      )}

      {showPostSaleModal && appearance==='workspace' && <WorkspaceDialog title="Venta guardada" onClose={handleNextOrder} className={`workspace-sale${smoothies ? ' smoothie-sale' : ''}`}>
        <div className="workspace-dialog-content"><p className="workspace-caption">{smoothies?'Pedido':'Folio'} #{savedSale?.ticket_number ?? lastOrderId}</p><p className="workspace-sale-total">${(savedSale?.total ?? getTotal()).toFixed(2)} MXN</p>
          {smoothies && savedSale && ['efectivo','mixto'].includes(savedSale.payment_method) && <p>Cambio: ${Number(savedSale.change_mxn).toFixed(2)} MXN</p>}
          {savedSale?.pager_number != null && <p className="font-bold">Entregar control #{savedSale.pager_number}</p>}
          <p>Consulta el estado en Impresión.</p>
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

             <h2 className="text-[32px] font-semibold tracking-tight text-[#1d1d1f] mb-2">Venta guardada</h2>
             <p className="text-[#86868b] text-[17px] mb-10 font-medium leading-relaxed">
               Consulta el estado en Impresión.
             </p>

             {printStatus}

             <button onClick={handleNextOrder} className="w-full bg-[#1d1d1f] hover:bg-[#000000] text-white h-[64px] rounded-2xl font-semibold text-[17px] shadow-xl shadow-black/10 active:scale-[0.98] transition-all">
               Nueva venta
             </button>

             <div className="mt-8">
               <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-[0.2em]">{posProfile.brand}</span>
             </div>
          </div>
        </div>
      )}

      {/* WIZARD ACTUALIZADO */}
      {!selectedFamily && selectedProduct && dynamicSteps.length > 0 && appearance==='owner' && (
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
                    const dbExtra = dbExtras.find(e => e.phase === dynamicSteps[customizationStep].id && e.name.toLowerCase() === optName.toLowerCase() && e.active && extraAppliesToProduct(e, selectedProduct.id));
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
                  Confirmar producto
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
              <h3 className="text-2xl font-black italic tracking-tight">{appearance==='workspace'?'Nuevo cliente':'Nuevo cliente'}</h3>
              <button disabled={isRegistering} aria-label="Cerrar nuevo cliente" onClick={() => setShowCustomerModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-400"><X size={20}/></button>
            </div>
            <form onSubmit={handleRegisterCustomer} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" required aria-label="Nombre" placeholder="Nombre" className="p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.firstName} onChange={e => setCustomerForm({...customerForm, firstName: e.target.value})} />
                <input type="text" aria-label="Apellido" placeholder="Apellido (opcional)" className="p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.lastName} onChange={e => setCustomerForm({...customerForm, lastName: e.target.value})} />
              </div>
              <label className="block">Cumpleaños (opcional)<input type="date" aria-label="Cumpleaños opcional" className="w-full p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.birthDate} onChange={e => setCustomerForm({...customerForm, birthDate: e.target.value})} /></label>
              <label className="block">Teléfono / WhatsApp (obligatorio)<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={60} aria-label="Teléfono obligatorio" placeholder="10 dígitos MX o número internacional" className="w-full p-3 rounded-xl bg-slate-50 outline-none text-sm" value={customerForm.whatsapp} onChange={e => setCustomerForm({...customerForm, whatsapp: e.target.value})} /></label>
              <p>50 puntos de bienvenida.</p>
              {customerRegisterError&&<p role="alert">{customerRegisterError}</p>}
              {customerRegisterError&&<button type="button" disabled={isRegistering} onClick={()=>void handleRegisterCustomer({preventDefault(){}} as React.FormEvent)}>Comprobar cliente</button>}
              <button type="submit" disabled={isRegistering} className="w-full bg-[#0071e3] text-white py-4 rounded-2xl font-bold flex justify-center items-center gap-2">
                {isRegistering ? <Loader2 className="animate-spin" /> : 'Guardar cliente'}
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
