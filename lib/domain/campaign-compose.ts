import { z } from 'zod';
import type { HouseholdRow } from '@/lib/types';
import type * as send from '@/lib/email/send';
import type * as strings from '@/lib/email/strings';
const schema=z.object({type:z.enum(['invitation','reminder','save_the_date','thank_you','custom']).default('reminder'),audience:z.enum(['not_responded','all','attending','declined']).default('not_responded'),channel:z.enum(['email','manual']).default('email'),subject:z.string().max(200).default(''),body:z.string().max(20000).default('')});
export type Compose={type:z.infer<typeof schema>['type'];audience:z.infer<typeof schema>['audience'];channel:'email'|'manual';customSubject:string;customBody:string};
export function normalizeCompose(input:unknown):Compose{
 const c=schema.parse(input);const customSubject=c.subject.trim(),customBody=c.body.trim();
 if(c.channel==='email'&&['custom','save_the_date','thank_you'].includes(c.type)&&(!customSubject||!customBody))throw new Error('Add a subject and message for this email.');
 return {type:c.type,audience:c.audience,channel:c.channel,customSubject,customBody};
}
type Renderer=Pick<typeof send,'invitationHtml'|'reminderHtml'|'emailShell'|'escapeHtml'>&Pick<typeof strings,'emailStrings'|'localeOf'>&{appUrl:string};
export function renderCampaign(h:Pick<HouseholdRow,'access_token'|'invite_code'|'preferred_locale'>,c:Compose,r:Renderer){
 if(c.type==='invitation')return r.invitationHtml({accessToken:h.access_token,inviteCode:h.invite_code,locale:h.preferred_locale});
 if(c.type==='reminder')return r.reminderHtml({accessToken:h.access_token,locale:h.preferred_locale});
 const s=r.emailStrings[r.localeOf(h.preferred_locale)];
 return {subject:c.customSubject,html:r.emailShell({heading:r.escapeHtml(c.customSubject),body:r.escapeHtml(c.customBody).replace(/\n/g,'<br/>'),
 ...(c.type==='thank_you'?{}:{cta:{label:s.reminderCta,url:`${r.appUrl}/rsvp/h/${h.access_token}`}})})};
}
