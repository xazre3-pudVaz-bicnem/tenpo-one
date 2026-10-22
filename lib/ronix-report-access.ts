import 'server-only';
import {createAdminClient} from '@/lib/supabase/admin';
import {can,type Role} from '@/lib/permissions';
import type {ReportGrant} from './ronix-report-grant';
/** Recheck current account, company, permissions and active stores on every read. */
export async function reportAccess(userId:string,organizationId:string,limitStores?:string[]){
 const db=createAdminClient();
 const [profile,org,membership,flags,stores]=await Promise.all([
  db.from('profiles').select('id,status,is_cypress_admin').eq('id',userId).maybeSingle(),
  db.from('organizations').select('id,name,status,kpi_settings').eq('id',organizationId).maybeSingle(),
  db.from('memberships').select('role').eq('profile_id',userId).eq('organization_id',organizationId).eq('status','active').maybeSingle(),
  db.from('feature_flags').select('flag_key').eq('organization_id',organizationId).eq('flag_key','reports').eq('enabled',false),
  db.from('stores').select('id,name,slug').eq('organization_id',organizationId).eq('status','active').order('id'),
 ]);
 if([profile,org,membership,flags,stores].some(r=>r.error))throw new Error('SOURCE_UNAVAILABLE');
 if(!profile.data||profile.data.status==='suspended'||!org.data||!['active','trial'].includes(org.data.status)||flags.data?.length)throw new Error('FORBIDDEN');
 if(!profile.data.is_cypress_admin&&(!membership.data||!['org_owner','hq_admin'].includes(membership.data.role)||!can(membership.data.role as Role,'reports.view')))throw new Error('FORBIDDEN');
 const allowed=(stores.data??[]).filter(s=>!limitStores||limitStores.includes(s.id));if(!allowed.length)throw new Error('FORBIDDEN');
 return{db,organization:org.data,stores:allowed};
}
export async function activeRonixGrant(token:string,grant:ReportGrant){
 const response=await fetch('https://ronix-agent.vercel.app/api/tenpo-sales/introspect',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jti:grant.jti,organizationId:grant.org}),cache:'no-store',signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok)throw new Error('FORBIDDEN');const result=await response.json();if(result.active!==true)throw new Error('FORBIDDEN');
}
