import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {work} from '../staging/runtime.mjs';
const directory=path.join(work,'cashiers'),id=randomUUID();
await writeFile(path.join(directory,'command.json'),JSON.stringify({id,action:process.argv[2]}));
for(let n=0;n<120;n++) {
  const result=JSON.parse(await readFile(path.join(directory,'command-result.json'),'utf8').catch(()=>'{}'));
  if(result.id===id) {console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;break;}
  if(n===119)throw Error('Cashier control timed out');
  await new Promise(r=>setTimeout(r,500));
}
