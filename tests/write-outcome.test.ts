import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isDefinitiveWriteRejection} from '../lib/write-outcome';

test('only known RPC business and input/integrity rejections retire a durable write identity',()=>{
  for(const code of ['P0001','22003','22P02','23503','23505','23514'])assert.equal(isDefinitiveWriteRejection(code),true,code);
  for(const code of ['08000','08006','08007','40003','40001','40P01','42501','57014','57P01','PGRST000','PGRST002','PGRST100','PGRST301','XX000','ABCDE','',null,undefined,{}]){
    assert.equal(isDefinitiveWriteRejection(code),false,String(code));
  }
});
