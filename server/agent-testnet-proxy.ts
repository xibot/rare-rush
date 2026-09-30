/** Same-site bridge to the existing Testnet verifier. Signatures and its rules
 * remain authoritative; this host never holds a verifier key or sends a tx. */
import { createPrivateRpcProxy, privateRpcProxy } from './private-rpc.ts';
const TESTNET='https://testnet.rarerush.app';
const LIMIT=1_800_000;
const windows=new Map<string,{count:number;until:number}>();
const json=(status:number,error:string)=>Response.json({error},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function limited(response:Request|Response,maximum=LIMIT){
  if(Number(response.headers.get('content-length'))>maximum||!response.body)throw new Error('size');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>maximum)throw new Error('size');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(body));
}
export async function agentTestnetProxy(request:Request,kind:'status'|'rpc'|'verify-run', fetcher:typeof fetch=fetch, env?:Record<string,string|undefined>){
  if(kind==='rpc')return (fetcher===fetch&&!env?privateRpcProxy:createPrivateRpcProxy({fetcher,env}))(request,'testnet');
  const method=kind==='status'?'GET':'POST';
  if(request.method!==method)return json(405,'Method not allowed.');
  const host=new URL(request.url).origin, origin=request.headers.get('origin');
  if(origin&&origin!==host||request.headers.get('sec-fetch-site')==='cross-site')return json(403,'Use Agent Play on this site.');
  if(method==='POST'&&(origin!==host||request.headers.get('content-type')?.split(';')[0]!=='application/json'))return json(403,'Use Agent Play on this site.');
  const now=Date.now(),key=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'shared';
  for(const [ip,w]of windows)if(w.until<now)windows.delete(ip);
  const window=windows.get(key)||{count:0,until:now+60_000};
  if(window.count>=90||windows.size>=4096)return json(429,'Please wait a minute before trying again.');window.count++;windows.set(key,window);
  try{
    const payload=method==='POST'?await limited(request):undefined;
    const reply=await fetcher(TESTNET+'/api/'+kind,{method,redirect:'error',signal:AbortSignal.timeout(40_000),headers:{'Content-Type':'application/json','Origin':TESTNET,'Sec-Fetch-Site':'same-origin'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const result=await limited(reply,2_500_000);
    return Response.json(result,{status:reply.status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{return json(503,'The Testnet connection is temporarily unavailable. Try again shortly.');}
}
