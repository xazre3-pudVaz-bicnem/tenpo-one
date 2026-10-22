import {getSessionContext} from '@/lib/auth';
import {redirect} from 'next/navigation';
import {reportAccess} from '@/lib/ronix-report-access';
export const dynamic='force-dynamic';
export default async function RonixAuthorize({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const params=await searchParams;const{state,challenge,organization}=params;
 if(!/^[a-f0-9]{32}$/.test(state??'')||!/^[\w-]{43}$/.test(challenge??'')||!/^[0-9a-f-]{36}$/.test(organization??''))return <main><h1>Invalid RONiX connection request</h1></main>;
 const ctx=await getSessionContext();if(!ctx)redirect('/login');
 let access;try{access=await reportAccess(ctx.userId,organization!);}catch{return <main><h1>This account cannot authorize company reports.</h1></main>;}
 return <main className="mx-auto max-w-xl space-y-5 p-8"><h1 className="text-2xl font-bold">Connect TENPO ONE reports to RONiX</h1><p>Company: <strong>{access.organization.name}</strong></p><p>Signed in: {ctx.displayName}</p><p>Allow RONiX Cloud to read sales totals, refunds, transaction counts and guest totals for these {access.stores.length} shops. Access lasts 30 days and works when your Mac is off.</p><ul>{access.stores.map(s=><li key={s.id}>{s.name}</li>)}</ul><p>No customer details, staff records, payment credentials, order changes or bank access. New shops require reconnecting. Disconnect in RONiX to revoke this connection.</p><p>Sales will be available in your private RONiX workspace and paired owner LINE chat. This does not authorize sending reports to clients.</p><form method="post" action="/api/integrations/ronix/authorize"><input type="hidden" name="state" value={state}/><input type="hidden" name="challenge" value={challenge}/><input type="hidden" name="organization" value={organization}/><button className="rounded bg-black px-5 py-3 text-white" type="submit">Allow read-only sales reports for 30 days</button></form><a href="https://ronix-agent.vercel.app/">Cancel and return to RONiX</a></main>;
}
