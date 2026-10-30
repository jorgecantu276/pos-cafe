export const cashierFixture = `'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
export default function CashierCheck() {
  const [result,setResult]=useState('Local synthetic cashier/tab acceptance.');
  async function inspect() {
    const {data,error}=await supabase.auth.getUser();
    const drafts=Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('mi_cafe_cart_draft:v1:')).map(k=>[k,JSON.parse(localStorage.getItem(k) || 'null')]));
    const pending=Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('mi_cafe_checkout_review:')).map(k=>[k,JSON.parse(localStorage.getItem(k) || 'null')]));
    const evidence={userId:data.user?.id ?? null,authError:Boolean(error),locks:Boolean(navigator.locks),drafts,pending};
    setResult(JSON.stringify(evidence,null,2));
    await fetch('/__cashier-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(evidence)});
  }
  async function signout() {
    const {error}=await supabase.auth.signOut({scope:'local'});
    if(error) {setResult(error.message);return;}
    location.assign('/login');
  }
  return <main style={{fontFamily:'system-ui',padding:36,maxWidth:1000,margin:'auto'}}>
    <h1>POS Café · isolated cashier and tab checks</h1><p>Synthetic local database only. Test controls are absent from the owner app.</p>
    <p><a href="/">Open cashier POS</a></p>
    <button onClick={inspect}>Record cashier and drafts</button>{' '}
    <button onClick={signout}>Sign out this local test session</button>
    <pre style={{whiteSpace:'pre-wrap',marginTop:24}}>{result}</pre>
  </main>;
}`;
