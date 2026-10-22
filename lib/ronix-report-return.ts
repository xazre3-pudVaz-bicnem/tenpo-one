import {RONIX_CALLBACK} from './ronix-report-grant';
/** Keep the POST on TENPO ONE; CSP form-action self also restricts redirect chains. */
export function reportConsentReturn(code:string,state:string){
 const callback=new URL(RONIX_CALLBACK);callback.searchParams.set('code',code);callback.searchParams.set('state',state);
 const href=callback.toString().replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Return to RONiX</title></head><body><main><h1>Read-only report permission approved</h1><p>Continue to RONiX within 2 minutes to finish connecting your company reports.</p><p><a href="${href}" rel="noreferrer">Continue to RONiX</a></p><p>This page does not display sales or customer details.</p></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
