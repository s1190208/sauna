// Check image URL reachability with inexpensive HEAD requests.
// HTTP responses from GitHub Actions may differ from the visitor's browser.
import fs from 'node:fs/promises';

const saunas=JSON.parse(await fs.readFile(new URL('../data/saunas.json',import.meta.url),'utf8'));
const results=new Array(saunas.length);
let cursor=0;
const MAX_WORKERS=5;
const TIMEOUT_MS=12000;

function isImageBytes(bytes){
 if(!bytes||bytes.length<12)return false;
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return true; // JPEG
 if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return true; // PNG
 const ascii=s=>Array.from(bytes.slice(0,Math.max(12,s.length))).map(x=>String.fromCharCode(x)).join('');
 const str=ascii('RIFF');
 return str.startsWith('GIF8')||(str.startsWith('RIFF')&&str.slice(8,12)==='WEBP')||(str.slice(4,12).startsWith('ftypavif'))||(str.slice(4,12).startsWith('ftypheic'));
}
async function testGet(url){
 const res=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{Range:'bytes=0-63','User-Agent':'Mozilla/5.0 (compatible; MySaunaAtlasPhotoAudit/1.0)','Accept':'image/avif,image/webp,image/*,*/*;q=0.8'}});
 const type=res.headers.get('content-type')||'';
 let signature=false;
 if(res.ok&&res.body){const reader=res.body.getReader();try{const chunk=await reader.read();signature=isImageBytes(chunk.value);}finally{await reader.cancel().catch(()=>{});}}
 const status=(res.status===404||res.status===410)?'broken':
  (res.status===401||res.status===403)?'blocked':
  res.status===429?'rate-limited':
  (res.ok&&(signature||type.startsWith('image/')))?'reachable-get':
  (res.ok)?'unexpected-type':'inconclusive';
 return {status,http:res.status,contentType:type,signature};
}
async function inspect(item){
 if(!/^https:\/\//i.test(item.photo||''))return {status:'missing',http:null};
 try{
  const res=await fetch(item.photo,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{'User-Agent':'MySaunaAtlas-photo-audit/1.0'}});
  const type=res.headers.get('content-type')||'';
  if(res.ok&&type.startsWith('image/'))return {status:'reachable',http:res.status,contentType:type};
  if(res.status===404||res.status===410)return {status:'broken',http:res.status,contentType:type};
  if(res.status===429)return {status:'rate-limited',http:res.status,contentType:type};
  try{
   const retry=await testGet(item.photo);
   return {...retry,headStatus:res.status,headContentType:type};
  }catch(err){return {status:(res.status===401||res.status===403)?'blocked':'inconclusive',http:res.status,contentType:type,getError:String(err?.cause?.code||err?.name||err).slice(0,120)};}
 }catch(err){return {status:'inconclusive',http:null,error:String(err?.cause?.code||err?.name||err).slice(0,150)};}
}
await Promise.all(Array.from({length:MAX_WORKERS},async()=>{
 while(cursor<saunas.length){
  const i=cursor++;const e=saunas[i];
  const check=await inspect(e);
  results[i]={id:e.id,name:e.name,tier:e.tier,url:e.photo,source:e.photoSource,...check};
  console.log(`${String(i+1).padStart(2,'0')}/${saunas.length} ${check.status.padEnd(16)} ${String(check.http||'-').padEnd(4)} ${e.name} ${check.contentType||''}${check.signature?' [image signature]':''}`);
 }
}));
const counts=results.reduce((o,e)=>(o[e.status]=(o[e.status]||0)+1,o),{});
const report={checkedAt:new Date().toISOString(),scope:'GitHub Actions runner, not an end-user browser',counts,results};
await fs.writeFile('photo-audit-results.json',JSON.stringify(report,null,2)+'\n');
console.log('\nSummary: '+JSON.stringify(counts));
console.log('Only broken=404/410 is strong negative evidence; blocked/inconclusive may work in a browser. reachable-get is verified by GET.');
