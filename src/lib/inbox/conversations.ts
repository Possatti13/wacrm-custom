import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, commercial lead profile,
 * and deterministic lead score, so the Inbox renders prioritisation and intelligence signals
 * without extra round-trips.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)), contact_lead_profiles(*), contact_lead_scores(*))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & {
  contact_tags?: { tags: Tag | null }[];
  contact_lead_profiles?: unknown;
  contact_lead_scores?: unknown;
};
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`
 * and unwrap the 1:1 `contact_lead_profiles` and `contact_lead_scores`.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, contact_lead_profiles, contact_lead_scores, ...contact } = rawContact;

  const leadProfile = Array.isArray(contact_lead_profiles)
    ? contact_lead_profiles[0] ?? null
    : contact_lead_profiles ?? null;

  const leadScore = Array.isArray(contact_lead_scores)
    ? contact_lead_scores[0] ?? null
    : contact_lead_scores ?? null;

  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
      lead_profile: leadProfile,
      lead_score: leadScore,
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
