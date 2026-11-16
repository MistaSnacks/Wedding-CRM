import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { defaultScope } from '@/lib/data/scope';
import { runAutomations } from '@/lib/automation/run';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request){const secret=env().CRON_SECRET;const received=request.headers.get('authorization')??'';const expected=`Bearer ${secret}`;
 if(!secret||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return NextResponse.json({error:'unauthorized'},{status:401});
 try{return NextResponse.json({ok:true,...await runAutomations(defaultScope())});}catch(e){console.error('Automation run failed',e);return NextResponse.json({error:'Automation processing failed; queued work remains saved.'},{status:503});}
}
