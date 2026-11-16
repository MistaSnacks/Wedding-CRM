import {describe,it,expect} from 'vitest';
import {paymentReminderStage,reminderScheduleDue,canRetryDelivery} from './rules';
describe('automation schedules',()=>{
 it('never reminds for a paid payment',()=>expect(paymentReminderStage('2026-09-01','2026-09-01',new Date('2026-09-04T20:00:00Z'),'America/Mexico_City')).toBeNull());
 it('uses the venue date near UTC midnight',()=>expect(paymentReminderStage('2026-09-10',null,new Date('2026-09-04T01:00:00Z'),'America/Mexico_City')).toBe('7-days'));
 it('overdue dedupe stage remains stable across days',()=>expect(paymentReminderStage('2026-09-01',null,new Date('2026-09-10T20:00:00Z'),'UTC')).toBe('overdue'));
 it('requires an approved start date and chosen weekday',()=>{const now=new Date('2026-09-07T20:00:00Z');expect(reminderScheduleDue(null,1,now,'UTC')).toBe(false);expect(reminderScheduleDue('2026-09-08',1,now,'UTC')).toBe(false);expect(reminderScheduleDue('2026-09-01',1,now,'UTC')).toBe(true);expect(reminderScheduleDue('2026-09-01',2,now,'UTC')).toBe(false);});
 it('requires reconciliation and never resends a known-sent delivery',()=>{expect(canRetryDelivery('failed',false)).toBe(false);expect(canRetryDelivery('sent',true)).toBe(false);expect(canRetryDelivery('failed',true)).toBe(true);});
});
