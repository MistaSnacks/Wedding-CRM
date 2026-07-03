"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as seating from "@/lib/data/seating";

export async function createTable(eventId: string, name: string, capacity: number): Promise<void> {
  const admin = await requireAdmin();
  await seating.upsertTable(forWedding(admin.weddingId), { eventId, name, capacity });
  revalidatePath("/admin/seating");
}

export async function saveTablePosition(tableId: string, posX: number, posY: number): Promise<void> {
  const admin = await requireAdmin();
  await seating.moveTable(forWedding(admin.weddingId), tableId, posX, posY);
}

export async function removeTable(tableId: string): Promise<void> {
  const admin = await requireAdmin();
  await seating.deleteTable(forWedding(admin.weddingId), tableId);
  revalidatePath("/admin/seating");
}

export async function assignGuest(guestId: string, eventId: string, tableId: string): Promise<void> {
  const admin = await requireAdmin();
  await seating.assign(forWedding(admin.weddingId), guestId, eventId, tableId, admin.userId);
  revalidatePath("/admin/seating");
}

export async function assignHousehold(guestIds: string[], eventId: string, tableId: string): Promise<void> {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  for (const guestId of guestIds) {
    await seating.assign(scope, guestId, eventId, tableId, admin.userId);
  }
  revalidatePath("/admin/seating");
}

export async function unassignGuest(guestId: string, eventId: string): Promise<void> {
  const admin = await requireAdmin();
  await seating.unassign(forWedding(admin.weddingId), guestId, eventId);
  revalidatePath("/admin/seating");
}

export async function setSeatingPublished(eventId: string, published: boolean): Promise<void> {
  const admin = await requireAdmin();
  await seating.setPublished(forWedding(admin.weddingId), eventId, published);
  revalidatePath("/admin/seating");
}
