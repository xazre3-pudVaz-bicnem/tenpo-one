import {verifyReportGrant,reportPeriod} from '@/lib/ronix-report-grant';
import {reportAccess,activeRonixGrant} from '@/lib/ronix-report-access';
import {computeSalesMetrics,SETTLED_ORDER_STATUSES,type SettledOrderLike,type RefundLike} from '@/lib/metrics';
import {todayJst} from '@/lib/format';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
 const token=request.headers.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1]??'';const grant=verifyReportGrant(token,'access',process.env.TENPO_RONIX_REPORT_SECRET??'');await activeRonixGrant(token,grant);
 const {db,organization,stores}=await reportAccess(grant.sub,grant.org,grant.stores);const params=new URL(request.url).searchParams;const{from,to}=reportPeriod(params.get('from')??todayJst(),params.get('to')??todayJst());const ids=stores.map(s=>s.id);
 const orders:Array<SettledOrderLike&{store_id:string}>=[],refunds:Array<RefundLike&{store_id:string}>=[];
 // Bound the range and paginate; never silently treat a truncated/error response as zero sales.
 for(let page=0;page<20;page++){
  const result=await db.from('orders').select('id,total,discount_total,guest_count,status,order_type,store_id').in('store_id',ids).gte('business_date',from).lte('business_date',to).in('status',SETTLED_ORDER_STATUSES).order('id').range(page*1000,page*1000+999);
  if(result.error)throw new Error('SOURCE_UNAVAILABLE');orders.push(...result.data);if(result.data.length<1000)break;if(page===19)throw new Error('SOURCE_UNAVAILABLE');
 }
 for(let page=0;page<20;page++){
  const result=await db.from('refunds').select('id,amount,kind,store_id').in('store_id',ids).gte('business_date',from).lte('business_date',to).order('id').range(page*1000,page*1000+999);
  if(result.error)throw new Error('SOURCE_UNAVAILABLE');refunds.push(...result.data);if(result.data.length<1000)break;if(page===19)throw new Error('SOURCE_UNAVAILABLE');
 }
 const opts={includeTakeoutGuests:(organization.kpi_settings as {includeTakeoutGuests?:boolean}|null)?.includeTakeoutGuests??true};
 return Response.json({source:'TENPO ONE',organizationId:organization.id,organizationName:organization.name,from,to,timeZone:'Asia/Tokyo',currency:'JPY',fetchedAt:new Date().toISOString(),stores:stores.map(s=>({id:s.id,name:s.name,...computeSalesMetrics(orders.filter(o=>o.store_id===s.id),refunds.filter(r=>r.store_id===s.id),opts)})),total:computeSalesMetrics(orders,refunds,opts)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const kind=error instanceof Error?error.message:'';return Response.json({error:kind==='INVALID_PERIOD'?'Use a valid date range of at most 31 days.':kind==='SOURCE_UNAVAILABLE'?'Sales source unavailable. No totals returned.':'Report connection is invalid, expired or revoked.'},{status:kind==='INVALID_PERIOD'?400:kind==='SOURCE_UNAVAILABLE'?503:403,headers:{'Cache-Control':'no-store'}});}
}
