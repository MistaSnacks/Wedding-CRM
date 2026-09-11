import { describe, expect, it } from "vitest";
import { DOCUMENT_MAX_BYTES, documentDownloadName, documentFileError, documentName, suggestDocumentKind } from "./documents";

describe("document upload guidance", () => {
  it("suggests common English and Spanish categories without calling an invoice a receipt", () => {
    expect(suggestDocumentKind("venue_contract_final.pdf")).toBe("contract");
    expect(suggestDocumentKind("florist-proposal.pdf")).toBe("quote");
    expect(suggestDocumentKind("Cotización Flores.pdf")).toBe("quote");
    expect(suggestDocumentKind("recibo_venue.jpg")).toBe("receipt");
    expect(suggestDocumentKind("invoice-23.pdf")).toBe("document");
    expect(suggestDocumentKind("IMG_2481.jpg")).toBe("document");
  });

  it("catches empty, oversized, and unsupported files before any upload", () => {
    const file = { name: "Contract.PDF", size: DOCUMENT_MAX_BYTES, type: "" };
    expect(documentFileError(file)).toBeNull();
    expect(documentFileError({ ...file, size: 0 })).toMatch(/empty/);
    expect(documentFileError({ ...file, size: DOCUMENT_MAX_BYTES + 1 })).toMatch(/over 3 MB/);
    expect(documentFileError({ ...file, name: "contract.docx" })).toMatch(/save a PDF/);
    expect(documentFileError({ ...file, name: "contract.pdf.exe" })).toMatch(/Choose a PDF/);
  });

  it("keeps readable names and the right download extension after renaming", () => {
    expect(documentName("Venue_contract.PDF")).toBe("Venue contract");
    expect(documentDownloadName("Signed venue contract", "application/pdf")).toBe("Signed venue contract.pdf");
    expect(documentDownloadName("Receipt.JPEG", "image/jpeg")).toBe("Receipt.JPEG");
    expect(documentDownloadName("contract.exe", "application/pdf")).toBe("contract.exe.pdf");
    expect(documentDownloadName("../receipt\n", "image/png")).toBe("..receipt.png");
  });
});
