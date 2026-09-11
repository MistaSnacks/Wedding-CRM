import { readAll } from "./query";
import type { WeddingScope } from "./scope";
import { headcountEstimate, validCalendarDay } from "./planning-rules";
import { invalidateCache } from "@/lib/limiter";
import * as vendors from "./vendors";
import * as activity from "./activity";

export type PlanningTask = { id: string; vendor_id: string | null; title: string; due_date: string | null; assigned_to: string | null; notes: string | null; completed_at: string | null };
export type VendorDocument = { id: string; vendor_id: string; name: string; kind: string; mime_type: string; size_bytes: number; created_at: string };
export async function tasks(scope: WeddingScope, vendorId?: string): Promise<PlanningTask[]> {
  return readAll<PlanningTask>(() => {
    let q = scope.db.from("planning_tasks").select("id,vendor_id,title,due_date,assigned_to,notes,completed_at").eq("wedding_id", scope.weddingId).order("due_date", { nullsFirst: false }).order("id");
    if (vendorId) q = q.eq("vendor_id", vendorId);
    return q;
  });
}
export async function createTask(scope: WeddingScope, input: { title: string; dueDate: string | null; vendorId: string | null; assignedTo: string; notes: string; operationId: string }, actorId: string) {
  if (!input.title.trim() || input.title.length > 300) throw new Error("Use a task title between 1 and 300 characters.");
  validCalendarDay(input.dueDate);
  if (input.vendorId) await vendors.get(scope, input.vendorId);
  const { error } = await scope.db.from("planning_tasks").insert({ id: input.operationId, wedding_id: scope.weddingId, title: input.title.trim(), due_date: input.dueDate, vendor_id: input.vendorId, assigned_to: input.assignedTo.trim() || null, notes: input.notes.trim() || null });
  if (error?.code === "23505") {
    const { data } = await scope.db.from("planning_tasks").select("title,vendor_id,due_date,assigned_to,notes").eq("wedding_id", scope.weddingId).eq("id", input.operationId).maybeSingle();
    if (data?.title === input.title.trim() && data.vendor_id === input.vendorId && data.due_date === input.dueDate && data.assigned_to === (input.assignedTo.trim() || null) && data.notes === (input.notes.trim() || null)) return;
  }
  if (error) throw new Error(error.message);
  await activity.log(scope, { actorType: "admin", actorId, action: "planning.task_created", payload: { taskId: input.operationId, title: input.title } });
}
export async function completeTask(scope: WeddingScope, id: string, complete: boolean) {
  const { data, error } = await scope.db.from("planning_tasks").update({ completed_at: complete ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("wedding_id", scope.weddingId).eq("id", id).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Task not found.");
}
export async function documents(scope: WeddingScope, vendorId?: string): Promise<VendorDocument[]> {
  if (vendorId) await vendors.get(scope, vendorId);
  return readAll<VendorDocument>(() => {
    let query = scope.db.from("vendor_documents").select("id,vendor_id,name,kind,mime_type,size_bytes,created_at").eq("wedding_id", scope.weddingId).order("created_at", { ascending: false }).order("id");
    if (vendorId) query = query.eq("vendor_id", vendorId);
    return query;
  });
}
export type HeadcountProposal = { itemId: string; itemName: string; eventId: string; eventName: string; ageScope: string; unitPriceCents: number; count: number; currentCents: number | null; proposedCents: number; currency: string };
export async function headcountProposals(scope: WeddingScope): Promise<HeadcountProposal[]> {
  const [links, items, events, guests, responses, invites, households] = await Promise.all([
    readAll<{item_id:string;event_id:string;age_scope:string;unit_price_cents:number}>(() => scope.db.from("budget_headcount_links").select("item_id,event_id,age_scope,unit_price_cents").eq("wedding_id", scope.weddingId).order("item_id")),
    readAll<{id:string;name:string;estimated_cents:number|null;currency:string}>(() => scope.db.from("budget_items").select("id,name,estimated_cents,currency").eq("wedding_id", scope.weddingId).order("id")),
    readAll<{id:string;name:string}>(() => scope.db.from("events").select("id,name").eq("wedding_id", scope.weddingId).order("id")),
    readAll<{id:string;household_id:string;age_type:string}>(() => scope.db.from("guests").select("id,household_id,age_type").eq("wedding_id", scope.weddingId).order("id")),
    readAll<{guest_id:string;event_id:string}>(() => scope.db.from("guest_event_responses").select("guest_id,event_id").eq("wedding_id", scope.weddingId).eq("attending", "yes").order("guest_id").order("event_id")),
    readAll<{household_id:string;event_id:string}>(() => scope.db.from("household_event_invites").select("household_id,event_id").eq("wedding_id", scope.weddingId).order("household_id").order("event_id")),
    readAll<{id:string}>(() => scope.db.from("households").select("id").eq("wedding_id", scope.weddingId).is("archived_at", null).order("id")),
  ]);
  const active = new Set(households.map(h => h.id));
  const guestById = new Map(guests.filter(g => active.has(g.household_id)).map(g => [g.id, g]));
  const invited = new Set(invites.map(i => `${i.household_id}:${i.event_id}`));
  return links.flatMap(link => {
    const item = items.find(i => i.id === link.item_id), event = events.find(e => e.id === link.event_id);
    if (!item || !event) return [];
    const count = new Set(responses.filter(r => { const g = guestById.get(r.guest_id); return r.event_id === link.event_id && g && invited.has(`${g.household_id}:${r.event_id}`) && (link.age_scope === "all" || g.age_type === link.age_scope); }).map(r => r.guest_id)).size;
    return [{ itemId: item.id, itemName: item.name, eventId: event.id, eventName: event.name, ageScope: link.age_scope, unitPriceCents: Number(link.unit_price_cents), count, currentCents: item.estimated_cents, proposedCents: headcountEstimate(count, Number(link.unit_price_cents)), currency: item.currency }];
  });
}
export async function applyHeadcount(scope: WeddingScope, expected: HeadcountProposal, actorId: string) {
  const { error } = await scope.db.rpc("apply_headcount_estimate", { p_wedding_id: scope.weddingId, p_item_id: expected.itemId,
    p_event_id: expected.eventId, p_age_scope: expected.ageScope, p_expected_count: expected.count,
    p_expected_unit: expected.unitPriceCents, p_expected_estimate: expected.currentCents, p_currency: expected.currency, p_actor_id: actorId });
  if (error) throw new Error(error.message);
  invalidateCache(`metrics:${scope.weddingId}`);
}
