import { isValidE164, normalizePhone } from '@/lib/whatsapp/phone-utils';
import type {
  DrilldownAction,
  Fact,
  FactDrilldownRef,
  OpaqueLeadEntity,
  PrivateEntityMap,
} from './types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAskConversationHref(
  entity: OpaqueLeadEntity
): string | null {
  // Identity comes exclusively from the authorized private map, never answer prose.
  return entity.conversation_id && UUID.test(entity.conversation_id)
    ? `/inbox?c=${entity.conversation_id}`
    : null;
}

export function getAskWhatsAppHref(
  entity: OpaqueLeadEntity,
  testWorkspace = false
): string | null {
  if (
    testWorkspace ||
    /\b(qa|teste?|demo|fixture|hygiene|cenário)\b/i.test(entity.contact_name)
  )
    return null;
  const phone = entity.phone?.trim();
  if (!phone || !/^\+?[\d\s().-]+$/.test(phone)) return null;
  const digits = normalizePhone(phone);
  // Without +, only the existing canonical BR shape proves that 55 was supplied.
  // A national phone/LID must never be silently assigned a country code.
  if (!phone.startsWith('+') && !/^55\d{10,11}$/.test(digits)) return null;
  if (
    !isValidE164(`+${digits}`) ||
    /(\d)\1{4,}/.test(digits) ||
    /5555|000000/.test(digits)
  )
    return null;
  return `https://wa.me/${digits}`;
}

export type AskSection =
  'attention' | 'objections' | 'products' | 'team' | 'coaching';
export interface AskDestination {
  label: string;
  href?: string;
  section?: AskSection;
  action: DrilldownAction;
}

function refIdentity(ref: FactDrilldownRef): string {
  return JSON.stringify([
    ref.type,
    ref.taxonomy_id ?? null,
    ref.taxonomy_code ?? null,
    ref.product_id ?? null,
    ref.seller_id ?? null,
    Object.entries(ref.filter ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

export function resolveAskDrilldown(
  action: DrilldownAction,
  facts: Fact[],
  entities: PrivateEntityMap
): AskDestination | null {
  if (!action.drilldown_ref || typeof action.drilldown_ref !== 'object')
    return null;
  // Synthesis drilldowns are model output: use only a matching deterministic fact ref.
  const ref = facts.find(
    (f) =>
      f.drilldown_ref &&
      refIdentity(f.drilldown_ref) === refIdentity(action.drilldown_ref)
  )?.drilldown_ref;
  if (!ref) return null;
  const grounded = { label: action.label, drilldown_ref: ref };
  const token = ref.filter?.lead_token;
  if (token !== undefined) {
    if (typeof token !== 'string' || !Object.hasOwn(entities, token))
      return null;
    const href = getAskConversationHref(entities[token]);
    return href
      ? {
          href,
          label: `Abrir conversa de ${entities[token].contact_name || 'contato'}`,
          action: grounded,
        }
      : null;
  }
  if (ref.filter && Object.keys(ref.filter).length > 0) return null;
  if (ref.type === 'deals')
    return { href: '/pipelines', label: 'Abrir Pipeline', action: grounded };
  const labels: Record<AskSection, string> = {
    attention: 'Ver atenção no Cockpit',
    objections: ref.taxonomy_code
      ? `Ver objeção: ${ref.title || ref.taxonomy_code}`
      : 'Ver objeções no Cockpit',
    products: 'Ver produtos no Cockpit',
    team: 'Ver equipe no Cockpit',
    coaching: 'Ver Coaching e Conversas',
  };
  if (!Object.hasOwn(labels, ref.type)) return null;
  // Dedicated taxonomy filtering requires the existing drawer's taxonomy_code.
  if (ref.type === 'objections' && ref.taxonomy_id && !ref.taxonomy_code)
    return null;
  return {
    section: ref.type as AskSection,
    label: labels[ref.type as AskSection],
    action: grounded,
  };
}
