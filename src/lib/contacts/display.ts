import type { Contact } from "@/types";
import { formatPhoneNumber } from "@/lib/whatsapp/phone-utils";

/**
 * Generic placeholders that should NOT be displayed as the contact's primary name
 * when a better identity (such as formatted phone or WA name) is available.
 */
const GENERIC_PLACEHOLDERS = new Set([
  "agent",
  "whatsapp contact",
  "contato whatsapp",
  "contato sem nome",
  "unknown",
  "customer",
  "cliente",
  "[object object]",
  "undefined",
  "null",
]);

/**
 * Checks whether a given name string is a generic placeholder.
 */
export function isGenericPlaceholderName(name?: string | null): boolean {
  if (!name || typeof name !== "string") return true;
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  return GENERIC_PLACEHOLDERS.has(trimmed);
}

/**
 * 5-tier canonical contact display name resolution:
 * 1. explicitly saved Ciclopes contact name (if not a generic placeholder)
 * 2. WhatsApp/provider chat/contact name
 * 3. provider push/notify name when trustworthy
 * 4. formatted phone number (+55 (11) 99999-8888)
 * 5. fallback ("Contato sem nome")
 */
export function getContactDisplayName(
  contact?: Partial<Contact> | null,
  fallback = "Contato sem nome"
): string {
  if (!contact) return fallback;

  // 1. Explicit name if not a generic placeholder
  if (contact.name && !isGenericPlaceholderName(contact.name)) {
    return contact.name.trim();
  }

  // 2. Formatted Phone number
  if (contact.phone) {
    const formatted = formatPhoneNumber(contact.phone);
    if (formatted) return formatted;
  }

  // 3. WhatsApp LID Identity fallback
  if (contact.whatsapp_lid) {
    return "Contato WhatsApp";
  }

  return fallback;
}

/**
 * Extracts 1-2 letter uppercase initials for avatar fallback.
 */
export function getContactInitials(name?: string | null): string {
  if (!name || typeof name !== "string") return "C";
  const clean = name.trim();
  if (!clean) return "C";

  // If name is a phone number like +55 (11) 99999-8888, use # or last digits
  if (/^\+?\d/.test(clean) || clean.startsWith("(")) {
    const digits = clean.replace(/\D/g, "");
    return digits.slice(-2) || "W";
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
