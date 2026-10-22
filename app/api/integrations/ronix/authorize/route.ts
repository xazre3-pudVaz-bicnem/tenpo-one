import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {getSessionContext} from '@/lib/auth';
import {reportAccess} from '@/lib/ronix-report-access';
import {RONIX_CALLBACK,signReportGrant} from '@/lib/ronix-report-grant';
export const runtime='nodejs';
export async function POST(request:Request){
 if(request.headers.get('origin')!=='https://www.tenpo-one.com'||new URL(request.url).origin!=='https://www.tenpo-one.com')return new Response('Forbidden',{status:403});
 const ctx=await getSessionContext();if(!ctx)return new Response('Sign in required',{status:401});
 try{const form=await request.formData();const state=String(form.get('state')??''),challenge=String(form.get('challenge')??''),org=String(form.get('organization')??'');
 if(!/^[a-f0-9]{32}$/.test(state)||!/^[\w-]{43}$/.test(challenge)||!/^[0-9a-f-]{36}$/.test(org))throw new Error('INVALID');
 const access=await reportAccess(ctx.userId,org),iat=Math.floor(Date.now()/1000);
 const code=signReportGrant({version:1,kind:'code',sub:ctx.userId,org,stores:access.stores.map(s=>s.id),jti:randomUUID(),iat,exp:iat+120,challenge,scope:'sales.summary.read',aud:'ronix-cloud'},process.env.TENPO_RONIX_REPORT_SECRET??'');
 const callback=new URL(RONIX_CALLBACK);callback.searchParams.set('code',code);callback.searchParams.set('state',state);
 const response=NextResponse.redirect(callback,303);response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
 }catch{return new Response('Connection could not be authorized. No report access was granted.',{status:403});}
}
