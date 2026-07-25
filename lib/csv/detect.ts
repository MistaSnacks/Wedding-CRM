import type { CsvMapping } from "./types";

/** Auto-detect column mapping from common header names. */
export function detectMapping(headers: string[]): CsvMapping {
  const find = (...cands: string[]) =>
    headers.find((h) => cands.some((c) => h.toLowerCase().replace(/[\s_-]/g, "") === c)) ?? "";
  return {
    firstName: find("firstname", "first", "givenname", "nombre"),
    lastName: find("lastname", "last", "surname", "familyname", "apellido"),
    household: find("household", "party", "group", "family") || undefined,
    envelope: find("envelope", "envelopename", "invitationname", "mailto", "addressee") || undefined,
    email: find("email", "emailaddress", "correo") || undefined,
    phone: find("phone", "phonenumber", "tel", "telefono") || undefined,
    ageType: find("agetype", "age", "type") || undefined,
    relationship: find("relationship", "relation") || undefined,
    maxPartySize: find("maxpartysize", "maxparty", "partysize") || undefined,
    plusOneSlots: find("plusoneslots", "plusones", "plusone") || undefined,
    locale: find("locale", "language", "lang", "idioma") || undefined,
  };
}
