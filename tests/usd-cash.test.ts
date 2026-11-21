import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receivedCashMXN,usdCashQuote} from '../lib/usd-cash';

test('cash USD rounds up to a whole dollar and returns only the excess in MXN',()=>{
  for(const [total,rate,usd,changeMXN] of [
    [128,16,8,0], [128.16,16,9,15.84], [128.32,16,9,15.68], [130,16,9,14], [143.84,16,9,0.16],
    [144,16,9,0], [130,20,7,10], [260,18,15,10], [1.12,0.14,8,0], [30.60,10.20,3,0], [130,16.3333,8,0.67], [130,15.075,9,5.68],
  ])assert.deepEqual(usdCashQuote(total,rate),{usd,changeMXN},`${total} MXN at ${rate}`);
  for(const rate of [0,-1,NaN,Infinity])assert.equal(usdCashQuote(130,rate),null);
});

test('cash conversion matches decimal cent rounding for fractional rates and mixed tender',()=>{
  assert.equal(receivedCashMXN(0,3,10.2),30.6);
  assert.equal(receivedCashMXN(0,9,15.075),135.68);
  assert.equal(receivedCashMXN(50,5,16),130);
  assert.equal(receivedCashMXN(0,20,16),320);
});
