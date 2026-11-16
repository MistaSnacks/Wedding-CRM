-- Durable delivery, frozen campaign reviews, and transactional sheet reconciliation.
create table email_outbox (
 id uuid primary key default gen_random_uuid(), wedding_id uuid not null references weddings(id) on delete cascade,
 dedupe_key text not null, household_id uuid references households(id) on delete set null,
 communication_id uuid references communications(id) on delete cascade, recipient text not null,
 subject text not null, html text not null, kind text not null default 'confirmation',
 state text not null default 'pending' check(state in ('pending','processing','sent','failed','suppressed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 first_attempt_at timestamptz, claimed_at timestamptz, claim_token uuid, message_id text unique,
 last_error text, created_at timestamptz not null default now(), sent_at timestamptz,
 unique(wedding_id,dedupe_key)
);
create index email_outbox_due on email_outbox(wedding_id,state,available_at);
create table email_suppressions (
 wedding_id uuid not null references weddings(id) on delete cascade, email text not null,
 reason text not null, created_at timestamptz not null default now(), primary key(wedding_id,email)
);
create table email_webhook_events (
 id text primary key, message_id text not null, event_type text not null,
 received_at timestamptz not null default now(), processed_at timestamptz
);
create table campaign_drafts (
 id uuid primary key default gen_random_uuid(), wedding_id uuid not null references weddings(id) on delete cascade,
 actor_id uuid not null references auth.users(id), compose jsonb not null, recipients jsonb not null,
 skipped jsonb not null default '[]', created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes', communication_id uuid references communications(id)
);
create table automation_settings (
 wedding_id uuid primary key references weddings(id) on delete cascade,
 reminders_enabled boolean not null default false, digest_enabled boolean not null default false,
 payment_reminders_enabled boolean not null default false, recipient_email text,
 updated_at timestamptz not null default now()
);
create table sync_runs (
 id uuid primary key default gen_random_uuid(), wedding_id uuid not null references weddings(id) on delete cascade,
 started_at timestamptz not null default now(), finished_at timestamptz,
 state text not null default 'running' check(state in ('running','success','failed')),
 result jsonb, error text
);
create index sync_runs_latest on sync_runs(wedding_id,started_at desc);
create table sheet_submission_versions (
 id bigint generated always as identity primary key, wedding_id uuid not null references weddings(id) on delete cascade,
 submission_id uuid not null references sheet_submissions(id) on delete cascade,
 snapshot jsonb not null, archived_at timestamptz not null default now()
);

alter table communication_recipients drop constraint communication_recipients_status_check;
alter table communication_recipients add constraint communication_recipients_status_check
 check(status in ('queued','sent','delivered','opened','bounced','failed','skipped','suppressed'));

-- New operational tables are accessible via scoped service functions; authenticated users get scoped reads only.
do $$ declare t text; begin
 foreach t in array array['email_outbox','email_suppressions','campaign_drafts','automation_settings','sync_runs','sheet_submission_versions'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy scoped_read on %I for select using (is_wedding_member(wedding_id))',t);
 end loop;
end $$;
alter table email_webhook_events enable row level security;

create function queue_campaign(p_wedding uuid,p_actor uuid,p_draft uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare d campaign_drafts; c uuid; r jsonb; h households; begin
 select * into d from campaign_drafts where id=p_draft and wedding_id=p_wedding and actor_id=p_actor for update;
 if not found then raise exception 'Review not found. Review the campaign again.'; end if;
 if d.communication_id is not null then return d.communication_id; end if;
 if d.expires_at < now() then raise exception 'This review expired. Review the campaign again.'; end if;
 -- A frozen recipient snapshot is never silently redirected to a changed contact.
 for r in select * from jsonb_array_elements(d.recipients) loop
 select * into h from households where id=(r->>'householdId')::uuid and wedding_id=p_wedding;
 if not found or h.archived_at is not null or lower(trim(coalesce(h.email,''))) <> lower(trim(r->>'to')) then
 raise exception 'A reviewed contact changed. Review the campaign again.'; end if;
 if d.compose->>'audience'='not_responded' and h.rsvp_status not in ('pending','started') then
 raise exception 'Someone responded since review. Review the campaign again.'; end if;
 end loop;
 insert into communications(wedding_id,type,channel,subject,body_template,audience_filter,sent_by)
 values(p_wedding,d.compose->>'type','email',d.compose->>'customSubject',d.compose->>'customBody',d.compose,p_actor) returning id into c;
 for r in select * from jsonb_array_elements(d.recipients) loop
 insert into communication_recipients(wedding_id,communication_id,household_id,email,status)
 values(p_wedding,c,(r->>'householdId')::uuid,r->>'to','queued');
 insert into email_outbox(wedding_id,dedupe_key,household_id,communication_id,recipient,subject,html,kind)
 values(p_wedding,'campaign:'||c||':'||(r->>'householdId'),(r->>'householdId')::uuid,c,r->>'to',r->>'subject',r->>'html',d.compose->>'type');
 end loop;
 update campaign_drafts set communication_id=c where id=d.id;
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload)
 values(p_wedding,'admin',p_actor,'communication.queued',jsonb_build_object('commId',c,'recipients',jsonb_array_length(d.recipients)));
 return c;
end $$;

create function claim_email_outbox(p_wedding uuid,p_limit integer default 10) returns setof email_outbox
language plpgsql security definer set search_path=public as $$ begin
 -- Beyond the provider idempotency window, ambiguous deliveries require manual reconciliation.
 update communication_recipients cr set status='failed',updated_at=now() from email_outbox o
 where o.wedding_id=p_wedding and cr.wedding_id=p_wedding and cr.communication_id=o.communication_id and cr.household_id=o.household_id
 and o.state in ('pending','processing') and o.first_attempt_at<now()-interval '20 hours';
 update email_outbox set state='failed',last_error='Delivery could not be confirmed within 20 hours; reconcile with the provider before retrying.'
 where wedding_id=p_wedding and state in ('pending','processing') and first_attempt_at < now()-interval '20 hours';
 return query with picked as (
 select id from email_outbox where wedding_id=p_wedding and attempts < 8 and available_at<=now()
 and (state='pending' or (state='processing' and claimed_at<now()-interval '5 minutes'))
 order by available_at,id for update skip locked limit greatest(1,least(p_limit,25))
 ) update email_outbox o set state='processing',claimed_at=now(),claim_token=gen_random_uuid(),
 first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1 from picked where o.id=picked.id returning o.*;
end $$;

create function finish_email_outbox(p_wedding uuid,p_id uuid,p_claim uuid,p_state text,p_message text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare o email_outbox; begin
 select * into o from email_outbox where id=p_id and wedding_id=p_wedding and claim_token=p_claim and state='processing' for update;
 if not found then return false; end if;
 if p_state not in ('sent','pending','failed','suppressed') then raise exception 'Invalid delivery state'; end if;
 update email_outbox set state=case when p_state='pending' and attempts>=8 then 'failed' else p_state end,
 message_id=coalesce(p_message,message_id),last_error=p_error,claim_token=null,
 sent_at=case when p_state='sent' then now() else sent_at end,
 available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)) where id=o.id;
 if p_state='sent' and o.metadata ? 'repairOf' then
 update email_outbox set resolved_at=now() where wedding_id=p_wedding and id=(o.metadata->>'repairOf')::uuid;
 end if;
 if o.communication_id is not null then
 update communication_recipients set status=case when p_state='pending' and o.attempts<8 then 'queued' when p_state='pending' then 'failed' else p_state end,
 resend_message_id=coalesce(p_message,resend_message_id),updated_at=now()
 where wedding_id=p_wedding and communication_id=o.communication_id and household_id=o.household_id;
 if p_state='sent' then update communications set sent_at=coalesce(sent_at,now()) where id=o.communication_id and wedding_id=p_wedding; end if;
 end if;
 return true;
end $$;

create function apply_email_event(p_id text,p_message text,p_type text) returns boolean
language plpgsql security definer set search_path=public as $$
declare e email_webhook_events; o email_outbox; s text; begin
 insert into email_webhook_events(id,message_id,event_type) values(p_id,p_message,p_type) on conflict(id) do nothing;
 select * into e from email_webhook_events where id=p_id for update;
 if e.processed_at is not null then return true; end if;
 select * into o from email_outbox where message_id=e.message_id;
 s:=case e.event_type when 'email.sent' then 'sent' when 'email.delivered' then 'delivered'
 when 'email.opened' then 'opened' when 'email.bounced' then 'bounced' when 'email.complained' then 'failed' else null end;
 if s is null then update email_webhook_events set processed_at=now() where id=e.id; return true; end if;
 if o.id is null and not exists(select 1 from communication_recipients where resend_message_id=e.message_id) then return false; end if;
 update communication_recipients set status=s,updated_at=now() where resend_message_id=e.message_id
 and array_position(array['queued','sent','delivered','opened','bounced','failed'],status)
 < array_position(array['queued','sent','delivered','opened','bounced','failed'],s);
 if s in ('bounced','failed') then
 update email_outbox set state='failed',last_error=e.event_type where message_id=e.message_id;
 insert into email_suppressions(wedding_id,email,reason)
 select wedding_id,lower(trim(email)),e.event_type from communication_recipients where resend_message_id=e.message_id and email is not null
 union select o.wedding_id,lower(trim(o.recipient)),e.event_type where o.id is not null
 on conflict(wedding_id,email) do update set reason=excluded.reason;
 end if;
 update email_webhook_events set processed_at=now() where id=e.id; return true;
end $$;

create function ingest_sheet_rows(p_wedding uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare r jsonb; s sheet_submissions; n integer:=0; begin
 perform pg_advisory_xact_lock(hashtextextended(p_wedding::text||':sheet',0));
 for r in select distinct on (x->>'rowKey') x from jsonb_array_elements(p_rows) x loop
 select * into s from sheet_submissions where wedding_id=p_wedding and source='save_the_date' and row_key=r->>'rowKey' for update;
 if not found then
 insert into sheet_submissions(wedding_id,source,row_key,raw,received_at) values(p_wedding,'save_the_date',r->>'rowKey',r->'raw',nullif(r->>'receivedAt','')::timestamptz);
 n:=n+1;
 elsif s.raw is distinct from r->'raw' then
 insert into sheet_submission_versions(wedding_id,submission_id,snapshot) values(p_wedding,s.id,to_jsonb(s));
 update sheet_submissions set raw=r->'raw',status='pending',resolved_at=now() where id=s.id;
 end if;
 end loop; return n;
end $$;

create function resolve_sheet_submission(p_wedding uuid,p_id uuid,p_household uuid,p_action text,p_applied jsonb default '{}',p_actor uuid default null,p_new jsonb default null,p_expected_raw jsonb default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare s sheet_submissions; h households; k text; v jsonb; patch jsonb:='{}'; hid uuid; begin
 select * into s from sheet_submissions where id=p_id and wedding_id=p_wedding for update;
 if not found then raise exception 'Response not found'; end if;
 if p_expected_raw is not null and s.raw is distinct from p_expected_raw then raise exception 'This response changed. Refresh and review the updated details.'; end if;
 if p_action='undo' then
 if s.status='created' then raise exception 'Remove a created household from the guest list instead.'; end if;
 if s.status='pending' then raise exception 'This response is already waiting for review.'; end if;
 p_applied:=coalesce(s.applied,'{}'); p_household:=s.household_id;
 elsif s.status <> 'pending' then raise exception 'This response was already resolved. Refresh the inbox.'; end if;
 if p_action='create' then
 insert into households(wedding_id,display_name,primary_contact_name,email,phone,mailing_address,preferred_locale,internal_notes,rsvp_status,invite_code,access_token,max_party_size,plus_one_slots)
 values(p_wedding,p_new->>'displayName',p_new->>'displayName',nullif(p_new->>'email',''),nullif(p_new->>'phone',''),nullif(p_new->'mailingAddress','null'::jsonb),coalesce(p_new->>'locale','en'),p_new->>'notes',coalesce(p_new->>'status','pending'),p_new->>'inviteCode',p_new->>'accessToken',1,0) returning id into hid;
 if coalesce(p_new->>'first','')<>'' or coalesce(p_new->>'last','')<>'' then
 insert into guests(wedding_id,household_id,first_name,last_name,origin) values(p_wedding,hid,p_new->>'first',coalesce(nullif(p_new->>'last',''),'—'),'named'); end if;
 insert into household_event_invites(wedding_id,household_id,event_id) select p_wedding,hid,id from events where wedding_id=p_wedding and visibility='all';
 elsif p_action in ('match','auto','undo') and p_household is not null then
 if p_action='auto' and s.resolved_at is not null then raise exception 'This response needs human review.'; end if;
 select * into h from households where id=p_household and wedding_id=p_wedding for update;
 if not found then raise exception 'Household not found'; end if;
 hid:=h.id;
 for k,v in select * from jsonb_each(coalesce(p_applied,'{}')) loop
 if k not in ('email','phone','mailing_address','preferred_locale','internal_notes','rsvp_status') then raise exception 'Invalid sheet field'; end if;
 if coalesce(to_jsonb(h)->k,'null') is distinct from coalesce(v->case when p_action='undo' then 'to' else 'from' end,'null') then
 raise exception 'The household changed. Refresh and review this response again.'; end if;
 patch:=patch||jsonb_build_object(k,v->case when p_action='undo' then 'from' else 'to' end);
 end loop;
 h:=jsonb_populate_record(h,patch);
 update households set email=h.email,phone=h.phone,mailing_address=h.mailing_address,preferred_locale=h.preferred_locale,internal_notes=h.internal_notes,rsvp_status=h.rsvp_status,updated_at=now() where id=hid;
 elsif p_action<>'ignore' then raise exception 'Invalid resolution'; end if;
 insert into sheet_submission_versions(wedding_id,submission_id,snapshot) values(p_wedding,s.id,to_jsonb(s));
 update sheet_submissions set status=case p_action when 'undo' then 'pending' when 'ignore' then 'ignored' when 'create' then 'created' else 'matched' end,
 household_id=case when p_action in ('undo','ignore') then null else hid end,
 applied=case when p_action in ('undo','ignore','create') then null else p_applied end,
 resolved_at=now(),resolved_by=p_actor where id=s.id;
 insert into activity_log(wedding_id,household_id,actor_type,actor_id,action,payload)
 values(p_wedding,hid,case when p_actor is null then 'system' else 'admin' end,p_actor,'sheet.'||p_action,jsonb_build_object('submissionId',s.id,'fields',patch));
 return hid;
end $$;

create function begin_sheet_sync(p_wedding uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare rid uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_wedding::text||':sync-run',0));
 if exists(select 1 from sync_runs where wedding_id=p_wedding and state='running' and started_at>now()-interval '5 minutes') then raise exception 'A sync is already running. Check again shortly.'; end if;
 update sync_runs set state='failed',finished_at=now(),error='Sync timed out before completion.' where wedding_id=p_wedding and state='running';
 insert into sync_runs(wedding_id) values(p_wedding) returning id into rid; return rid;
end $$;

revoke execute on function queue_campaign(uuid,uuid,uuid),claim_email_outbox(uuid,integer),finish_email_outbox(uuid,uuid,uuid,text,text,text),apply_email_event(text,text,text),ingest_sheet_rows(uuid,jsonb),resolve_sheet_submission(uuid,uuid,uuid,text,jsonb,uuid,jsonb,jsonb),begin_sheet_sync(uuid) from public,anon,authenticated;
grant execute on function queue_campaign(uuid,uuid,uuid),claim_email_outbox(uuid,integer),finish_email_outbox(uuid,uuid,uuid,text,text,text),apply_email_event(text,text,text),ingest_sheet_rows(uuid,jsonb),resolve_sheet_submission(uuid,uuid,uuid,text,jsonb,uuid,jsonb,jsonb),begin_sheet_sync(uuid) to service_role;

alter table email_outbox add column metadata jsonb not null default '{}';
alter table automation_settings add column reminder_start_date date;
alter table automation_settings add column reminder_weekday integer not null default 1 check(reminder_weekday between 0 and 6);
alter table automation_settings add column reminder_cap integer not null default 3 check(reminder_cap between 1 and 10);
alter table automation_settings add column digest_cadence text not null default 'daily' check(digest_cadence in ('daily','weekly'));
alter table automation_settings add column last_digest_hash text;

alter table automation_settings add column last_digest_day date;
create function queue_planning_digest(p_wedding uuid,p_day date,p_hash text,p_subject text,p_html text) returns boolean
language plpgsql security definer set search_path=public as $$
declare s automation_settings; begin
 select * into s from automation_settings where wedding_id=p_wedding for update;
 if not found or not s.digest_enabled or s.recipient_email is null or s.last_digest_day=p_day or s.last_digest_hash=p_hash then return false; end if;
 insert into email_outbox(wedding_id,dedupe_key,recipient,subject,html,kind)
 values(p_wedding,'digest:'||p_day,s.recipient_email,p_subject,p_html,'planning_digest') on conflict(wedding_id,dedupe_key) do nothing;
 update automation_settings set last_digest_hash=p_hash,last_digest_day=p_day where wedding_id=p_wedding;return true;
end $$;
revoke execute on function queue_planning_digest(uuid,date,text,text,text) from public,anon,authenticated;
grant execute on function queue_planning_digest(uuid,date,text,text,text) to service_role;

create index email_webhook_pending on email_webhook_events(received_at) where processed_at is null;
create function replay_email_events(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=public as $$
declare e email_webhook_events; n integer:=0; begin
 -- Test/direct sends have no outbox row. Keep their event record without letting
 -- unmatched events starve correlated deliveries behind them.
 for e in select * from email_webhook_events we where we.processed_at is null and
 (exists(select 1 from email_outbox o where o.message_id=we.message_id) or exists(select 1 from communication_recipients cr where cr.resend_message_id=we.message_id))
 order by received_at limit greatest(1,least(p_limit,200)) loop
 perform apply_email_event(e.id,e.message_id,e.event_type); n:=n+1;
 end loop;
 update email_webhook_events set processed_at=now() where processed_at is null and received_at<now()-interval '24 hours';
 return n;
end $$;
revoke execute on function replay_email_events(integer) from public,anon,authenticated;
grant execute on function replay_email_events(integer) to service_role;

alter table email_outbox add column resolved_at timestamptz;
create table automation_runs (
 id uuid primary key default gen_random_uuid(),wedding_id uuid not null references weddings(id) on delete cascade,
 started_at timestamptz not null default now(),finished_at timestamptz,
 state text not null default 'running' check(state in ('running','success','failed')),result jsonb,error text
);
create index automation_runs_latest on automation_runs(wedding_id,started_at desc);
alter table automation_runs enable row level security;
create policy scoped_read on automation_runs for select using(is_wedding_member(wedding_id));

-- Freeze the complete provider request before its first attempt, including sender settings.
alter table email_outbox add column sender text;
alter table email_outbox add column reply_to text;
alter table automation_settings add column reminder_templates jsonb;
