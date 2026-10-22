import {it,expect} from 'vitest';
import {reportConsentReturn} from '../lib/ronix-report-return';
it('finishes same-origin POST with a fixed safe callback link instead of a CSP-blocked redirect',async()=>{
 const response=reportConsentReturn('test-code<&"','state&x');
 expect(response.status).toBe(200);expect(response.headers.get('location')).toBeNull();expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 const html=await response.text();expect(html).toContain('href="https://ronix-agent.vercel.app/api/tenpo-sales/callback?code=test-code%3C%26%22&amp;state=state%26x"');expect(html).not.toContain('<form');expect(html).not.toContain('<script');
});
