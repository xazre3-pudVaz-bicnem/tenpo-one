import {createHmac,createHash,timingSafeEqual,hkdfSync} from 'node:crypto';
import {z} from 'zod';
/** Domain-separated server-only key; no Supabase credential is put in a grant. */
export function reportSigningSecret(){
 const dedicated=process.env.TENPO_RONIX_REPORT_SECRET;if(dedicated&&dedicated.length>=32)return dedicated;
 const root=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!root||root.length<32)throw new Error('CONFIG');
 return Buffer.from(hkdfSync('sha256',root,'TENPO_ONE_SIGNING_KEYS_V1','ronix-sales-summary-grants-v1',32)).toString('base64url');
}
export const RONIX_ORIGIN='https://ronix-agent.vercel.app';
export const RONIX_CALLBACK=RONIX_ORIGIN+'/api/tenpo-sales/callback';
const claims=z.object({version:z.literal(1),kind:z.enum(['code','access']),sub:z.string().uuid(),org:z.string().uuid(),stores:z.array(z.string().uuid()).min(1).max(100),jti:z.string().uuid(),iat:z.number().int(),exp:z.number().int(),challenge:z.string().regex(/^[\w-]{43}$/).optional(),scope:z.literal('sales.summary.read'),aud:z.literal('ronix-cloud')});
export type ReportGrant=z.infer<typeof claims>;
export function signReportGrant(value:ReportGrant,secret:string){if(secret.length<32)throw new Error('CONFIG');const body=Buffer.from(JSON.stringify(claims.parse(value))).toString('base64url');return body+'.'+createHmac('sha256',secret).update('tenpo-ronix-v1:'+body).digest('base64url');}
export function verifyReportGrant(token:string,kind:'code'|'access',secret:string,now=Math.floor(Date.now()/1000)):ReportGrant{
 if(secret.length<32||token.length>12000)throw new Error('UNAUTHORIZED');const [body,signature,...extra]=token.split('.');if(!body||!signature||extra.length)throw new Error('UNAUTHORIZED');
 const expected=createHmac('sha256',secret).update('tenpo-ronix-v1:'+body).digest();const received=Buffer.from(signature,'base64url');if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new Error('UNAUTHORIZED');
 const result=claims.parse(JSON.parse(Buffer.from(body,'base64url').toString('utf8')));if(result.kind!==kind||result.iat>now+5||result.exp<=now||result.exp-result.iat>(kind==='code'?120:30*86400))throw new Error('UNAUTHORIZED');return result;
}
export function pkceMatches(verifier:string,challenge:string){return /^[\w-]{43,128}$/.test(verifier)&&createHash('sha256').update(verifier).digest('base64url')===challenge;}
export function reportPeriod(from:string,to:string){
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>30*86400000)throw new Error('INVALID_PERIOD');return{from,to};
}
