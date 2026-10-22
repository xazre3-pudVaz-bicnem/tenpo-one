import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {signReportGrant,verifyReportGrant,pkceMatches,reportPeriod,type ReportGrant} from '../lib/ronix-report-grant';
const secret='test-key-only-'.repeat(4),now=1000000;
const grant:ReportGrant={version:1,kind:'access',sub:'00000000-0000-4000-8000-000000000001',org:'00000000-0000-4000-8000-000000000002',stores:['00000000-0000-4000-8000-000000000003'],jti:'00000000-0000-4000-8000-000000000004',iat:now,exp:now+60,scope:'sales.summary.read',aud:'ronix-cloud'};
describe('RONiX read-only grants',()=>{
 it('binds signed company/store scope and rejects tamper, expiry, wrong kind/key',()=>{const token=signReportGrant(grant,secret);expect(verifyReportGrant(token,'access',secret,now).org).toBe(grant.org);for(const run of [()=>verifyReportGrant(token+'a','access',secret,now),()=>verifyReportGrant(token,'code',secret,now),()=>verifyReportGrant(token,'access',secret,now+61),()=>verifyReportGrant(token,'access','other'.repeat(10),now)])expect(run).toThrow();});
 it('requires the PKCE verifier and bounded real calendar dates',()=>{const v='a'.repeat(43),c=createHash('sha256').update(v).digest('base64url');expect(pkceMatches(v,c)).toBe(true);expect(pkceMatches('b'.repeat(43),c)).toBe(false);expect(()=>reportPeriod('2026-02-30','2026-03-01')).toThrow();expect(()=>reportPeriod('2026-01-01','2026-03-01')).toThrow();expect(reportPeriod('2026-10-22','2026-10-22').from).toBe('2026-10-22');});
});
