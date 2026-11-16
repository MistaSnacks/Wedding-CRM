import {describe,it,expect} from 'vitest';
import {normalizeCompose,renderCampaign} from './campaign-compose';
import {escapeHtml,emailShell,invitationHtml,reminderHtml} from '@/lib/email/send';
import {emailStrings,localeOf} from '@/lib/email/strings';
describe('campaign composition',()=>{
 it('rejects empty save-the-date and thank-you messages',()=>{for(const type of ['save_the_date','thank_you','custom'])expect(()=>normalizeCompose({type})).toThrow('subject and message');});
 it('validates untrusted audience and type',()=>expect(()=>normalizeCompose({type:'made-up',audience:'invalid'})).toThrow());
 it('escapes custom text and omits RSVP CTA for thank-you',()=>{const c=normalizeCompose({type:'thank_you',subject:'<b>Thanks</b>',body:'<script>alert(1)</script>\nLove'});const rendered=renderCampaign({access_token:'preview',invite_code:'test',preferred_locale:'en'},c,{appUrl:'https://example.com',escapeHtml,emailShell,invitationHtml,reminderHtml,emailStrings,localeOf});expect(rendered.html).toContain('&lt;script&gt;');expect(rendered.html).not.toContain('<script>');expect(rendered.html).not.toContain('/rsvp/h/');});
});
