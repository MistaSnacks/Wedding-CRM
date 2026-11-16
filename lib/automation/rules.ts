import { calendarDayDelta, calendarDayIn } from '@/lib/format/wedding-date';
export function paymentReminderStage(due:string,paid:string|null,now:Date,zone:string):string|null{
 if(paid)return null;const days=calendarDayDelta(due,now,zone);
 return days===7?'7-days':days===1?'1-day':days<0?'overdue':null;
}
export function reminderScheduleDue(start:string|null,weekday:number,now:Date,zone:string):boolean{
 if(!start)return false;const day=calendarDayIn(now,zone);return day>=start&&new Date(`${day}T12:00:00Z`).getUTCDay()===weekday;
}
export function canRetryDelivery(state:string,confirmed:boolean):boolean{return confirmed&&['failed','suppressed'].includes(state);}
