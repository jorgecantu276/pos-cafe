import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdministrator, AccessError, userInput } from '../lib/user-management';

test('the actual user route refuses non-admin callers before body parsing or service-role construction', async () => {
  const source=readFileSync(new URL('../app/api/users/route.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  for(const role of ['anonymous','cashier','barista','admin']) {
    let bodyRead=false,privileged=false;
    const caller={auth:{getUser:async()=>({data:{user:role==='anonymous'?null:{id:'actor'}},error:null})},
      from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,is_active:role!=='admin'},error:null})})})}),
    } as unknown as SupabaseClient;
    const exports:Record<string,(r:Request)=>Promise<Response>>={};
    const require=(name:string)=> {
      if(name==='@supabase/supabase-js') return {createClient:()=>{privileged=true;throw new Error('Must not create');}};
      if(name==='next/server') return {NextResponse:Response};
      if(name==='@/lib/supabase-server') return {serverSupabase:async()=>caller};
      if(name==='@/lib/user-management') return {requireAdministrator,AccessError,userInput};
      throw new Error(name);
    };
    new Function('require','exports',compiled)(require,exports);
    for(const method of ['POST','PATCH']) {
      const response=await exports[method]({json:async()=>{bodyRead=true;return {};}} as unknown as Request);
      assert.equal(response.status,role==='anonymous'?401:403);assert.equal(bodyRead,false);assert.equal(privileged,false);
    }
  }
});
