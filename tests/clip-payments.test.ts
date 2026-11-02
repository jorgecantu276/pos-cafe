import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ClipGateway} from '../lib/clip-server';
import {clipSettings} from '../lib/clip-config';
import {executeCheckout,CheckoutRejected,ClipPaymentPending,type CheckoutReview} from '../lib/checkout';
import {handleClipWebhook} from '../supabase/functions/clip-webhook/index';

const request=randomUUID(),actor=randomUUID(),provider='pinpad-'+randomUUID();
const config={enabled:true,tokenReady:true,token:'TEST_ONLY_FAKE_TOKEN',serial:'TESTSERIAL',webhook:'https://test.invalid/functions/v1/clip-webhook'};
function harness(options:{lost?:boolean;change?:Record<string,unknown>;unavailable?:boolean}={}) {
  const payment={request_id:request,actor_id:actor,state:'prepared',provider_id:null as string|null,terminal_serial:'TESTSERIAL',webhook_key:randomUUID(),hints:[] as string[],quote:{total:50},result:null as unknown};
  let posts=0,settlements=0;
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{
    if(name==='pos_clip_get')return {data:structuredClone(payment),error:null};
    if(name==='pos_clip_claim'){const claimed=payment.state==='prepared';if(claimed)payment.state='dispatching';return {data:{claimed},error:null};}
    if(name==='pos_clip_attach'){payment.provider_id=args.p_provider as string;payment.state='pending';return {data:null,error:null};}
    if(name==='pos_clip_settle'){settlements++;payment.state=args.p_outcome==='completed'?'completed':'failed';payment.result={id:'order',total:50};return {data:payment.result,error:null};}
    assert.fail(`Unexpected RPC ${name}`);
  }} as unknown as Pick<SupabaseClient,'rpc'>;
  const fetcher:typeof fetch=async(url,options)=>{
    assert.ok(String(url).startsWith('https://api.payclip.io/f2f/pinpad/v1/payment'));
    assert.equal(new Headers(options?.headers).get('Authorization'),'Basic TEST_ONLY_FAKE_TOKEN');
    assert.equal(options?.redirect,'error');
    if(options?.method==='POST') {
      posts++;const body=JSON.parse(options.body as string);
      assert.equal(body.amount,'50.00');assert.equal(body.reference,'pos-'+request);
      assert.equal(body.preferences.is_split_payment_enabled,false);assert.equal(body.preferences.is_tip_enabled,false);
      const callback=new URL(body.webhook_url);assert.equal(callback.searchParams.get('request'),request);assert.equal(callback.searchParams.get('key'),payment.webhook_key);
      return Response.json({pinpad_request_id:provider});
    }
    return Response.json({pinpad_request_id:provider,reference:'pos-'+request,amount:'50.00',amount_paid:'50.00',tip_amount:'0.00',status:'COMPLETED',
      detail:{pages:{total:1,total_results:1},results:[{transaction_id:randomUUID(),status:'approved',currency:'MXN',amount:50,paid_amount:50,tip_amount:0,amount_refunded:0,device:{id:'TESTSERIAL'}}]},...optionsChange});
  };
  const optionsChange=options.change;
  const sending:typeof fetch=async(url,init)=>{
    if(init?.method==='POST'&&(options.lost||options.unavailable)){
      posts++;
      if(options.lost)throw Error('Lost provider response');
      return Response.json({code:'ERR10_04'},{status:400});
    }
    return fetcher(url,init);
  };
  return {payment,gateway:new ClipGateway(db,config,sending),get posts(){return posts;},get settlements(){return settlements;}};
}
test('CLIP placeholder/configuration cannot enable charges or expose the token to UI flags',()=>{
  const env={POS_CLIP_ENABLED:'1',POS_CLIP_TOKEN:'REPLACE_WITH_CLIP_BASIC_TOKEN',POS_CLIP_SERIAL:'TESTSERIAL',NEXT_PUBLIC_SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test'};
  assert.equal(clipSettings(env).enabled,false);
  assert.equal(clipSettings({...env,POS_CLIP_TOKEN:'dGVzdDprZXktbm90LWEtcmVhbC1zZWNyZXQ='}).enabled,true);
  assert.equal(clipSettings({...env,POS_CLIP_TOKEN:'dGVzdDprZXktbm90LWEtcmVhbC1zZWNyZXQ=',POS_CLIP_WEBHOOK_URL:'http://localhost:3101/hook'}).enabled,false);
});
test('concurrent/replayed CLIP starts dispatch one provider POST and verified approval settles the saved sale',async()=>{
  const h=harness();await Promise.all([h.gateway.start(request,actor),h.gateway.start(request,actor)]);
  assert.equal(h.posts,1);assert.equal(h.payment.state,'completed');
  const before=h.settlements;const replay=await h.gateway.start(request,actor);assert.equal(replay.state,'completed');assert.equal(h.posts,1);assert.equal(h.settlements,before);
});
test('a lost provider creation acknowledgment never resends; a late verified callback hint recovers the payment',async()=>{
  const h=harness({lost:true});await h.gateway.start(request,actor);await h.gateway.start(request,actor);
  assert.equal(h.posts,1);assert.equal(h.payment.state,'dispatching');assert.equal(h.settlements,0);
  h.payment.hints=[provider];assert.equal((await h.gateway.status(request,actor)).state,'completed');assert.equal(h.posts,1);assert.equal(h.settlements,1);
});
test('wrong amounts, references, device/currency, partial payments and malformed approval remain unresolved',async()=>{
  const detail=(change:Record<string,unknown>)=>({pages:{total:1,total_results:1},results:[{transaction_id:randomUUID(),status:'approved',currency:'MXN',amount:50,paid_amount:50,tip_amount:0,amount_refunded:0,device:{id:'TESTSERIAL'},...change}]});
  for(const change of [{amount:'51.00'},{amount_paid:'49.00'},{reference:'other'},{tip_amount:'1.00'},
    {detail:detail({currency:'USD'})},{detail:detail({device:{id:'OTHER'}})},{detail:detail({status:'declined'})},
    {detail:detail({amount_refunded:50})},{detail:{pages:{total:2,total_results:2},results:[]}}, {detail:undefined}]) {
    const h=harness({change});await h.gateway.start(request,actor);assert.equal(h.posts,1);assert.equal(h.settlements,0);assert.notEqual(h.payment.state,'completed');
  }
});
test('only the documented unavailable-device rejection releases an unsent payment',async()=>{
  const h=harness({unavailable:true});assert.equal((await h.gateway.start(request,actor)).state,'failed');await h.gateway.start(request,actor);assert.equal(h.posts,1);
});
test('webhook validates nonce/event shape and stores a hint, never an approval or a provider charge',async()=>{
  const key=randomUUID();let calls=0;
  const send:typeof fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://local-test.invalid/rest/v1/rpc/pos_clip_notify');
    assert.deepEqual(JSON.parse(init?.body as string),{p_request:request,p_key:key,p_provider:provider});return new Response(null,{status:204});};
  const env=(name:string)=>name==='SUPABASE_URL'?'https://local-test.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'?'fake-service-secret':undefined;
  const body={id:provider,origin:'pinpad-payments-api',event_type:'PINPAD_INTENT_STATUS_CHANGED',status:'APPROVED'};
  assert.equal((await handleClipWebhook(new Request(`https://hook.invalid?request=${request}&key=${key}`,{method:'POST',body:JSON.stringify(body)}),env,send)).status,200);assert.equal(calls,1);
  assert.equal((await handleClipWebhook(new Request(`https://hook.invalid?request=${request}`,{method:'POST',body:JSON.stringify(body)}),env,send)).status,400);assert.equal(calls,1);
});
test('client payment recovery uses GET, retains pending results and never falls back to manual checkout',async()=>{
  const previous=globalThis.fetch;const pending:CheckoutReview={requestId:request,provider:'clip',startedAt:'today',total:50,payload:{register_id:'r',items:[],payment_method:'tarjeta',expected_total:50,tender_mxn:0,tender_usd:0,customer_id:null,order_type:'En Local',order_note:'',pager_number:12}};
  let posts=0,reads=0,known=false;
  globalThis.fetch=async(_url,options)=>{if(options?.method==='POST'){posts++;known=true;return Response.json({state:'pending',requestId:request,message:'Esperando CLIP'});}reads++;return known?Response.json({state:'pending',requestId:request,message:'Esperando CLIP'}):Response.json({error:'No encontrado'},{status:404});};
  const db={rpc:()=>assert.fail('No manual checkout for a CLIP payment')} as unknown as Pick<SupabaseClient,'rpc'>;
  try {
    await assert.rejects(executeCheckout(db,pending),ClipPaymentPending);await assert.rejects(executeCheckout(db,pending),ClipPaymentPending);assert.equal(posts,1);assert.equal(reads,2);
    globalThis.fetch=async()=>Response.json({error:'Revisa el catálogo',notSent:true},{status:409});
    await assert.rejects(executeCheckout(db,pending),CheckoutRejected);
  }
  finally{globalThis.fetch=previous;}
});
