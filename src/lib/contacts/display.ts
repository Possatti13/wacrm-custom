import type { Contact } from "@/types";
import { formatPhoneNumber, isValidDisplayPhone } from "@/lib/whatsapp/phone-utils";

/**
 * Canonical set of generic placeholders and technical identifiers that must NEVER
 * be presented as an authoritative contact name.
 */
const GENERIC_PLACEHOLDERS = new Set([
  "agent",
  "whatsapp contact",
  "contato whatsapp",
  "contato sem nome",
  "sem nome",
  "contato",
  "unknown",
  "unknown contact",
  "customer",
  "cliente",
  "cliente desconhecido",
  "usuario",
  "usuário",
  "user",
  "contact",
  "[object object]",
  "undefined",
  "null",
  "0",
  "+0",
  "none",
  "n/a",
  "-",
  "--",
]);

/**
 * Checks whether a given name string is a generic placeholder or technical artifact.
 */
export function isGenericPlaceholderName(name?: string | null): boolean {
  if (!name || typeof name !== "string") return true;
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return true;

  if (GENERIC_PLACEHOLDERS.has(trimmed)) return true;

  // If the string consists entirely of zeros (e.g. "0", "00", "+0000")
  const strippedDigits = trimmed.replace(/\D/g, "");
  if (strippedDigits.length > 0 && /^0+$/.test(strippedDigits) && trimmed.replace(/[\s+0]/g, "").length === 0) {
    return true;
  }

  return false;
}

/**
 * Canonical 5-tier contact display name resolution:
 * 1. explicitly saved Ciclopes contact name (if not a generic placeholder)
 * 2. WhatsApp/provider push name or chat name (if not a generic placeholder)
 * 3. formatted valid phone number (+55 (11) 99999-8888)
 * 4. WhatsApp LID fallback ("Contato WhatsApp")
 * 5. neutral fallback ("Contato sem nome")
 *
 * Never renders "0", "+0", technical placeholders, or fabricated data.
 */
export function getContactDisplayName(
  contact?: (Partial<Contact> & { whatsapp_name?: string | null; push_name?: string | null }) | null,
  fallback = "Contato sem nome",
  providerPushName?: string | null
): string {
  // Default fallback if falsy
  const safeFallback = fallback && fallback.trim() ? fallback.trim() : "Contato sem nome";

  if (!contact) {
    if (providerPushName && !isGenericPlaceholderName(providerPushName)) {
      return providerPushName.trim();
    }
    return safeFallback;
  }

  // 1. Explicit saved name if not a generic placeholder
  if (contact.name && !isGenericPlaceholderName(contact.name)) {
    return contact.name.trim();
  }

  // 2. WhatsApp / Provider push name if available on contact or passed directly
  const waName = contact.whatsapp_name || contact.push_name || providerPushName;
  if (waName && !isGenericPlaceholderName(waName)) {
    return waName.trim();
  }

  // 3. Formatted Phone number (only if genuinely valid)
  if (contact.phone && isValidDisplayPhone(contact.phone)) {
    const formatted = formatPhoneNumber(contact.phone);
    if (formatted) return formatted;
  }

  // 4. WhatsApp LID Identity fallback
  if (contact.whatsapp_lid) {
    return "Contato WhatsApp";
  }

  return safeFallback;
}

/**
 * Extracts 1-2 uppercase characters for avatar fallback.
 * Hierarchy:
 * - Real name: 1 or 2 uppercase letters from name parts.
 * - Phone number: Neuter initial "W" (WhatsApp), NEVER raw sliced digits like "77", "48", "33", "0".
 * - Fallback: Neuter initial "C" (Contato).
 */
export function getContactInitials(name?: string | null): string {
  if (!name || typeof name !== "string") return "C";
  const clean = name.trim();
  if (!clean || isGenericPlaceholderName(clean)) return "C";

  // If name is a phone number or numeric format (e.g. +55 (11) 99999-8888 or digits),
  // NEVER slice last numbers into "77", "48", "33", "0". Use neutral "W" (WhatsApp).
  if (/^\+?\d/.test(clean) || clean.startsWith("(")) {
    return "W";
  }

  // Alphabetic name parts
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const letters = parts[0].replace(/[^a-zA-ZÀ-ÿ]/g, "");
    return (letters.slice(0, 2) || "C").toUpperCase();
  }

  const firstLetter = parts[0].replace(/[^a-zA-ZÀ-ÿ]/g, "").charAt(0);
  const lastLetter = parts[parts.length - 1].replace(/[^a-zA-ZÀ-ÿ]/g, "").charAt(0);

  if (firstLetter && lastLetter) {
    return (firstLetter + lastLetter).toUpperCase();
  }
  if (firstLetter) {
    return firstLetter.toUpperCase();
  }

  return "C";
}

