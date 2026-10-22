import {randomUUID} from 'node:crypto';
import {reportConsentReturn} from '@/lib/ronix-report-return';
import {getSessionContext} from '@/lib/auth';
import {reportAccess} from '@/lib/ronix-report-access';
import {reportSigningSecret,signReportGrant} from '@/lib/ronix-report-grant';
export const runtime='nodejs';
export async function POST(request:Request){
 if(request.headers.get('origin')!=='https://www.tenpo-one.com'||new URL(request.url).origin!=='https://www.tenpo-one.com')return new Response('Forbidden',{status:403});
 const ctx=await getSessionContext();if(!ctx)return new Response('Sign in required',{status:401});
 try{const form=await request.formData();const state=String(form.get('state')??''),challenge=String(form.get('challenge')??''),org=String(form.get('organization')??'');
 if(!/^[a-f0-9]{32}$/.test(state)||!/^[\w-]{43}$/.test(challenge)||!/^[0-9a-f-]{36}$/.test(org))throw new Error('INVALID');
 const access=await reportAccess(ctx.userId,org),iat=Math.floor(Date.now()/1000);
 const code=signReportGrant({version:1,kind:'code',sub:ctx.userId,org,stores:access.stores.map(s=>s.id),jti:randomUUID(),iat,exp:iat+120,challenge,scope:'sales.summary.read',aud:'ronix-cloud'},reportSigningSecret());
 return reportConsentReturn(code,state);
 }catch{return new Response('Connection could not be authorized. No report access was granted.',{status:403});}
}
