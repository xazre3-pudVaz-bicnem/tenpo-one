import {reportSigningSecret,verifyReportGrant,signReportGrant,pkceMatches} from '@/lib/ronix-report-grant';
export const runtime='nodejs';
export async function POST(request:Request){
 try{const raw=await request.text();if(raw.length>16000)throw new Error();const body=JSON.parse(raw);if(typeof body.code!=='string'||typeof body.verifier!=='string')throw new Error();const secret=reportSigningSecret(),code=verifyReportGrant(body.code,'code',secret);
 if(!code.challenge||!pkceMatches(body.verifier,code.challenge))throw new Error();const iat=Math.floor(Date.now()/1000);const access={...code,kind:'access' as const,challenge:undefined,iat,exp:iat+30*86400};
 return Response.json({token:signReportGrant(access,secret),organizationId:code.org,expiresAt:new Date(access.exp*1000).toISOString(),jti:code.jti},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Invalid or expired authorization code'},{status:401});}
}
