import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { staffAvatars, staffAvatarSource } from '../lib/staff-avatars';
import { userInput } from '../lib/user-management';

test('staff avatars are bundled and a chosen avatar survives create/edit validation', () => {
  assert.deepEqual(staffAvatars.map(avatar=>avatar.label),['Hombre','Mujer']);
  for(const avatar of staffAvatars) {
    const asset=readFileSync(path.join('public',avatar.src),'utf8');
    assert.match(asset,/<svg/);assert.ok(Buffer.byteLength(asset)<3000);
    for(const create of [true,false]) {
      const input=userInput({username:'ana',password:create?'test-password':'',role:'cashier',avatar_url:avatar.src},create);
      assert.equal(staffAvatarSource(input.avatar_url,input.username),avatar.src);
    }
  }
  assert.equal(staffAvatarSource(null,'Sandra'),staffAvatarSource('', 'sandra'));
  assert.ok(staffAvatars.some(avatar=>avatar.src===staffAvatarSource('https://legacy.example/photo.jpg','sandra')));
  assert.throws(()=>userInput({username:'ana',password:'test-password',role:'cashier',avatar_url:'/other/photo.svg'},true));
});
