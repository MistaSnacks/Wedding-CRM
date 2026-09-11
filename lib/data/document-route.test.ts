import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_MAX_BYTES } from "@/lib/documents";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), editor: vi.fn(), vendor: vi.fn(), db: { from: vi.fn(), storage: { from: vi.fn() } }, revalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.admin, requireEditor: mocks.editor }));
vi.mock("@/lib/data/scope", () => ({ forWedding: (weddingId: string) => ({ weddingId, db: mocks.db }) }));
vi.mock("@/lib/data/vendors", () => ({ get: mocks.vendor }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
import { GET, POST, DELETE } from "@/app/admin/(dashboard)/vendors/documents/route";

const origin = "http://localhost:3006";
const url = `${origin}/admin/vendors/documents`;
let query: Record<string, ReturnType<typeof vi.fn>>;
let storage: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ weddingId: "wedding-one", role: "owner" });
  mocks.editor.mockResolvedValue({ weddingId: "wedding-one", role: "owner" });
  mocks.vendor.mockResolvedValue({ id: "vendor-one" });
  query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), insert: vi.fn(), delete: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.delete.mockReturnValue(query);
  query.insert.mockResolvedValue({ error: null });
  storage = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }), createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example.test/private-file" }, error: null }) };
  mocks.db.from.mockReturnValue(query); mocks.db.storage.from.mockReturnValue(storage);
});

function uploadRequest(file = new File(["%PDF-1.4 test"], "original.pdf", { type: "application/pdf" }), requestOrigin = origin) {
  const body = new FormData(); body.set("file", file); body.set("vendorId", "vendor-one"); body.set("kind", "contract"); body.set("name", "Venue agreement");
  return new Request(url, { method: "POST", headers: { origin: requestOrigin }, body });
}

describe("private vendor documents", () => {
  it("saves the chosen name and returns confirmed metadata for the list", async () => {
    const response = await POST(uploadRequest()); const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.document).toMatchObject({ vendor_id: "vendor-one", name: "Venue agreement", mime_type: "application/pdf", kind: "contract" });
    expect(mocks.editor).toHaveBeenCalledOnce();
    expect(mocks.vendor).toHaveBeenCalledWith(expect.objectContaining({ weddingId: "wedding-one" }), "vendor-one");
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ wedding_id: "wedding-one", name: "Venue agreement", storage_path: expect.stringMatching(/^wedding-one\/vendor-one\//) }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/documents");
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/vendors/vendor-one");
  });

  it("rejects cross-origin and read-only writes before touching storage", async () => {
    expect((await POST(uploadRequest(undefined, "https://other.test"))).status).toBe(403);
    mocks.editor.mockRejectedValue(new Error("Read-only access"));
    expect((await POST(uploadRequest())).status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await DELETE(new Request(url, { method: "DELETE", headers: { origin }, body: JSON.stringify({ id: "file-one" }) }))).status).toBe(400);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("rejects oversized and disguised files and cleans up a failed metadata save", async () => {
    const large = new File([new Uint8Array(DOCUMENT_MAX_BYTES + 1)], "large.pdf", { type: "application/pdf" });
    expect((await POST(uploadRequest(large))).status).toBe(400);
    expect((await POST(uploadRequest(new File(["<html>fake</html>"], "fake.pdf", { type: "application/pdf" })))).status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
    query.insert.mockResolvedValue({ error: { message: "database unavailable" } });
    expect((await POST(uploadRequest())).status).toBe(400);
    expect(storage.remove).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
  });

  it("previews and downloads only wedding-scoped files using short-lived links", async () => {
    query.maybeSingle.mockResolvedValue({ data: { storage_path: "private/file", name: "Venue agreement", mime_type: "application/pdf" }, error: null });
    const preview = await GET(new Request(`${url}?id=file-one&preview=1`));
    expect(preview.status).toBe(302); expect(preview.headers.get("cache-control")).toContain("no-store");
    expect(query.eq).toHaveBeenCalledWith("wedding_id", "wedding-one");
    expect(storage.createSignedUrl).toHaveBeenLastCalledWith("private/file", 60, {});
    await GET(new Request(`${url}?id=file-one`));
    expect(storage.createSignedUrl).toHaveBeenLastCalledWith("private/file", 60, { download: "Venue agreement.pdf" });
  });

  it("never signs a URL for a missing or other-wedding file", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(new Request(`${url}?id=other-file`))).status).toBe(404);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
