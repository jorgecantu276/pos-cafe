import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
const execute=promisify(execFile),prefix='pos-ops-loopback-';

/** The legacy compiler needs short tool paths; business/config/state never moves. */
export async function operationsLoopbackTool({sourceFile,portPrefix}) {
  assert.equal(process.platform,'win32');assert.ok(['5590','5592'].includes(portPrefix));
  const tempRoot=await realpath(tmpdir()),bin=await mkdtemp(path.join(tempRoot,prefix));
  const source=path.join(bin,'loopback.cs'),launcher=path.join(bin,'docker.exe');
  async function dispose(){
    const resolved=await realpath(bin).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!resolved)return;
    assert.equal(path.dirname(resolved),tempRoot);assert.ok(path.basename(resolved).startsWith(prefix));
    const stat=await lstat(bin);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
    assert.ok((await readdir(bin)).every(name=>['loopback.cs','docker.exe'].includes(name)),'Unexpected tool files require review.');
    await rm(resolved,{recursive:true,force:true});
  }
  try {
    await writeFile(source,(await readFile(sourceFile,'utf8')).replaceAll('5545',portPrefix),{flag:'wx'});
    const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    // Also isolate the compiler working directory from a deep private state path.
    await execute(compiler,['/nologo','/target:exe',`/out:${launcher}`,source],{cwd:bin,windowsHide:true,timeout:60_000});
    await execute(launcher,['--pos-cafe-self-test'],{cwd:bin,windowsHide:true,timeout:10_000});
    return {bin,launcher,dispose};
  }catch(error){await dispose();throw error;}
}
