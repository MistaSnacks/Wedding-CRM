import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/lib/testing/database";
let db: Awaited<ReturnType<typeof createTestDatabase>>;
const w = "90100000-0000-4000-8000-000000000001", other = "90100000-0000-4000-8000-000000000002";
const e = "90200000-0000-4000-8000-000000000001", hh = "90300000-0000-4000-8000-000000000001", g = "90400000-0000-4000-8000-000000000001";
const category = "90500000-0000-4000-8000-000000000001", item = "90600000-0000-4000-8000-000000000001";
beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(`insert into weddings(id,slug,couple_names) values('${w}','planning-test','Planning Test'),('${other}','planning-other','Other Test');
    insert into events(id,wedding_id,name) values('${e}','${w}','Dinner');
    insert into households(id,wedding_id,display_name,invite_code,access_token) values('${hh}','${w}','Party','PLANNING1','planning-test-token');
    insert into guests(id,wedding_id,household_id,first_name,last_name) values('${g}','${w}','${hh}','Test','Guest');
    insert into household_event_invites(household_id,event_id,wedding_id) values('${hh}','${e}','${w}') on conflict do nothing;
    insert into guest_event_responses(guest_id,event_id,wedding_id,attending) values('${g}','${e}','${w}','yes') on conflict(guest_id,event_id) do update set attending='yes';
    insert into budget_categories(id,wedding_id,name,slug) values('${category}','${w}','Food','planning-food');
    insert into budget_items(id,wedding_id,category_id,name,estimated_cents,quoted_cents,contracted_cents,currency) values('${item}','${w}','${category}','Dinner',100,9000,12000,'USD');
    insert into budget_headcount_links(item_id,wedding_id,event_id,unit_price_cents) values('${item}','${w}','${e}',2500);`);
}, 120000);
afterAll(async () => { await db?.close(); });
describe("budget readiness database invariants", () => {
  it("applies a reviewed headcount atomically and preserves contract prices", async () => {
    await db.query(`select apply_headcount_estimate($1,$2,$3,'all',1,2500,100,'USD',null)`, [w,item,e]);
    const result = await db.query<{estimated_cents:number;contracted_cents:number;quoted_cents:number}>(`select estimated_cents,contracted_cents,quoted_cents from budget_items where id=$1`, [item]);
    expect(Number(result.rows[0].estimated_cents)).toBe(2500); expect(Number(result.rows[0].contracted_cents)).toBe(12000); expect(Number(result.rows[0].quoted_cents)).toBe(9000);
    await expect(db.query(`select apply_headcount_estimate($1,$2,$3,'all',1,2500,100,'USD',null)`, [w,item,e])).rejects.toThrow(/changed/);
  });
  it("refuses a foreign wedding and excludes retained responses after uninviting", async () => {
    await expect(db.query(`select apply_headcount_estimate($1,$2,$3,'all',1,2500,2500,'USD',null)`, [other,item,e])).rejects.toThrow(/not found/);
    await db.query(`delete from household_event_invites where household_id=$1 and event_id=$2`, [hh,e]);
    await expect(db.query(`select apply_headcount_estimate($1,$2,$3,'all',1,2500,2500,'USD',null)`, [w,item,e])).rejects.toThrow(/changed/);
    await db.query(`select apply_headcount_estimate($1,$2,$3,'all',0,2500,2500,'USD',null)`, [w,item,e]);
    const r = await db.query<{estimated_cents:number}>(`select estimated_cents from budget_items where id=$1`, [item]); expect(Number(r.rows[0].estimated_cents)).toBe(0);
  });
  it("excludes archived households even when their invite and yes response remain", async () => {
    await db.query(`insert into household_event_invites(household_id,event_id,wedding_id) values($1,$2,$3)`, [hh,e,w]);
    await db.query(`update households set archived_at=now() where id=$1`, [hh]);
    await expect(db.query(`select apply_headcount_estimate($1,$2,$3,'all',1,2500,0,'USD',null)`, [w,item,e])).rejects.toThrow(/changed/);
    await db.query(`select apply_headcount_estimate($1,$2,$3,'all',0,2500,0,'USD',null)`, [w,item,e]);
  });
  it("guards vendor sync against manual edits and keeps document deletion atomic", async () => {
    const vendor = "90700000-0000-4000-8000-000000000001";
    await db.query(`insert into vendors(id,wedding_id,name,contracted_cents,currency) values($1,$2,'Planner',15000,'USD')`, [vendor,w]);
    await db.query(`update budget_items set vendor_id=$1,contracted_cents=null,contracted_source='manual' where id=$2`, [vendor,item]);
    const apply = (price:number|null,source:string|null) => db.query<{applied:boolean}>(`select apply_vendor_contract_price($1,$2,$3,$4,$5,15000,'USD') applied`,[w,vendor,item,price,source]);
    expect((await apply(null,'manual')).rows[0].applied).toBe(true);
    await db.query(`update budget_items set contracted_cents=17000,contracted_source='manual' where id=$1`,[item]);
    expect((await apply(15000,'vendor')).rows[0].applied).toBe(false);
    expect((await apply(17000,'manual')).rows[0].applied).toBe(false);
    await db.query(`insert into vendor_documents(wedding_id,vendor_id,name,storage_path,mime_type,size_bytes) values($1,$2,'Contract','planning/test','application/pdf',100)`,[w,vendor]);
    await expect(db.query(`select remove_planning_vendor($1,$2,null)`,[w,vendor])).rejects.toThrow(/Remove the uploaded/);
    expect((await db.query<{vendor_id:string}>(`select vendor_id from budget_items where id=$1`,[item])).rows[0].vendor_id).toBe(vendor);
    await db.query(`delete from vendor_documents where vendor_id=$1`,[vendor]);
    await db.query(`select remove_planning_vendor($1,$2,null)`,[w,vendor]);
    expect((await db.query<{vendor_id:null;contracted_cents:number}>(`select vendor_id,contracted_cents from budget_items where id=$1`,[item])).rows[0]).toMatchObject({vendor_id:null});
  });
  it("creates both schedule installments atomically, safely replays, and preserves manual prices", async () => {
    const fresh = "90600000-0000-4000-8000-000000000002";
    await db.query(`insert into budget_items(id,wedding_id,category_id,name,contracted_cents,currency) values($1,$2,$3,'Venue',99000,'USD')`,[fresh,w,category]);
    const split = (total:number) => db.query<{created:boolean}>(`select split_budget_payment_schedule($1,$2,$3,2000,'2026-10-01','2026-11-01',null) created`,[w,fresh,total]);
    expect((await split(10000)).rows[0].created).toBe(true);
    expect((await split(10000)).rows[0].created).toBe(false);
    await expect(split(20000)).rejects.toThrow(/already has/);
    const count=await db.query<{count:number}>(`select count(*) count from budget_payments where budget_item_id=$1`,[fresh]); expect(Number(count.rows[0].count)).toBe(2);
    const price=await db.query<{contracted_cents:number}>(`select contracted_cents from budget_items where id=$1`,[fresh]); expect(Number(price.rows[0].contracted_cents)).toBe(99000);
  });
  it("prevents cross-currency payment storage and parent currency relabeling", async () => {
    await expect(db.query(`insert into budget_payments(wedding_id,budget_item_id,label,amount_cents,currency) values($1,$2,'Deposit',100,'MXN')`, [w,item])).rejects.toThrow(/currency/);
    await db.query(`insert into budget_payments(wedding_id,budget_item_id,label,amount_cents,currency) values($1,$2,'Deposit',100,'USD')`, [w,item]);
    await expect(db.query(`update budget_items set currency='MXN' where id=$1`, [item])).rejects.toThrow(/currency/);
  });
  it("does not expose the headcount mutation to public callers and creates a private document bucket", async () => {
    const privileges = await db.query<{anon:boolean;authenticated:boolean}>(`select has_function_privilege('anon','apply_headcount_estimate(uuid,uuid,uuid,text,integer,bigint,bigint,text,uuid)','execute') anon,has_function_privilege('authenticated','apply_headcount_estimate(uuid,uuid,uuid,text,integer,bigint,bigint,text,uuid)','execute') authenticated`);
    expect(privileges.rows[0]).toEqual({ anon:false, authenticated:false });
    const bucket = await db.query<{public:boolean}>(`select public from storage.buckets where id='wedding-documents'`); expect(bucket.rows[0].public).toBe(false);
  });
});
