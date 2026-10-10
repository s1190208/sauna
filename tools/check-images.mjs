// Check image URL reachability with inexpensive HEAD requests.
// HTTP responses from GitHub Actions may differ from the visitor's browser.
import fs from 'node:fs/promises';

const saunas=JSON.parse(await fs.readFile(new URL('../data/saunas.json',import.meta.url),'utf8'));
const results=new Array(saunas.length);
let cursor=0;
const MAX_WORKERS=5;
const TIMEOUT_MS=12000;

async function inspect(item){
 if(!/^https:\/\//i.test(item.photo||''))return {status:'missing',http:null};
 try{
  let res=await fetch(item.photo,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{'User-Agent':'MySaunaAtlas-photo-audit/1.0'}});
  if(res.status===405||res.status===501){
   res=await fetch(item.photo,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{Range:'bytes=0-0','User-Agent':'MySaunaAtlas-photo-audit/1.0'}});
   await res.body?.cancel();
  }
  const type=res.headers.get('content-type')||'';
  const status=(res.status===404||res.status===410)?'broken':
   (res.status===401||res.status===403)?'blocked':
   res.status===429?'rate-limited':
   (res.ok&&type.startsWith('image/'))?'reachable':
   (res.ok&&type&& !type.startsWith('image/'))?'unexpected-type':'inconclusive';
  return {status,http:res.status,contentType:type};
 }catch(err){return {status:'inconclusive',http:null,error:String(err?.cause?.code||err?.name||err).slice(0,150)};}
}

await Promise.all(Array.from({length:MAX_WORKERS},async()=>{
 while(cursor<saunas.length){
  const i=cursor++;const e=saunas[i];
  const check=await inspect(e);
  results[i]={id:e.id,name:e.name,tier:e.tier,url:e.photo,source:e.photoSource,...check};
  console.log(`${String(i+1).padStart(2,'0')}/${saunas.length} ${check.status.padEnd(16)} ${String(check.http||'-').padEnd(4)} ${e.name}`);
 }
}));
const counts=results.reduce((o,e)=>(o[e.status]=(o[e.status]||0)+1,o),{});
const report={checkedAt:new Date().toISOString(),scope:'GitHub Actions runner, not an end-user browser',counts,results};
await fs.writeFile('photo-audit-results.json',JSON.stringify(report,null,2)+'\n');
console.log('\nSummary: '+JSON.stringify(counts));
console.log('Only broken=404/410 is strong negative evidence; blocked/inconclusive may work in a browser.');
