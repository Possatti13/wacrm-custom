import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  TenantObjectionTaxonomy,
  ObjectionSummaryResult,
} from './types'

export const DEFAULT_OBJECTION_TAXONOMY_CODES = [
  { code: 'price_budget', name: 'Preço / Orçamento', description: 'Preço elevado, fora do orçamento ou capacidade financeira' },
  { code: 'payment_financing', name: 'Pagamento / Financiamento', description: 'Condições de parcelamento, taxa de juros ou recusa de crédito' },
  { code: 'timing', name: 'Momento / Timing', description: 'Não é o momento ideal, vai adiar compra ou priorizar outro gasto' },
  { code: 'competition', name: 'Concorrência', description: 'Comparando com concorrente, proposta concorrente mais vantajosa' },
  { code: 'trust', name: 'Confiança / Segurança', description: 'Insegurança sobre reputação, garantia, procedência ou entrega' },
  { code: 'decision_authority', name: 'Alçada de Decisão', description: 'Precisa consultar sócio, cônjuge, diretoria ou terceiros' },
  { code: 'fit_requirements', name: 'Aderência / Requisitos', description: 'Dúvidas se produto/serviço atende necessidades específicas' },
  { code: 'availability_delivery', name: 'Disponibilidade / Prazo', description: 'Prazo de entrega longo, indisponibilidade ou falta de estoque' },
  { code: 'other', name: 'Outra Objeção', description: 'Objeção não enquadrada nas categorias padronizadas acima' },
] as const

/**
 * Ensures that the tenant has the default taxonomy categories seeded (service_role / system).
 */
export async function ensureTenantObjectionTaxonomy(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db.rpc('ensure_tenant_default_objection_taxonomy', {
    p_account_id: accountId,
  })
  if (error) {
    throw new Error(`ensureTenantObjectionTaxonomy failed: ${error.message}`)
  }
}

/**
 * Initializes default taxonomy categories for an account as an authenticated admin.
 */
export async function initializeTenantObjectionTaxonomy(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db.rpc('initialize_tenant_objection_taxonomy', {
    p_account_id: accountId,
  })
  if (error) {
    throw new Error(`initializeTenantObjectionTaxonomy failed: ${error.message}`)
  }
}

/**
 * Lists active objection taxonomy categories for an account.
 */
export async function listTenantObjectionTaxonomy(
  db: SupabaseClient,
  accountId: string
): Promise<TenantObjectionTaxonomy[]> {
  const { data, error } = await db
    .from('tenant_objection_taxonomy')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('position', { ascending: true })

  if (error) {
    throw new Error(`listTenantObjectionTaxonomy failed: ${error.message}`)
  }

  return (data || []) as TenantObjectionTaxonomy[]
}

/**
 * Overrides the taxonomy category of an objection occurrence (human correction).
 */
export async function overrideObjectionTaxonomy(
  db: SupabaseClient,
  accountId: string,
  occurrenceId: string,
  newTaxonomyId: string,
  reason?: string | null
): Promise<{ success: boolean; effective_taxonomy_id: string }> {
  const { data, error } = await db.rpc('override_objection_taxonomy', {
    p_account_id: accountId,
    p_occurrence_id: occurrenceId,
    p_new_taxonomy_id: newTaxonomyId,
    p_reason: reason || null,
  })

  if (error) {
    throw new Error(`overrideObjectionTaxonomy failed: ${error.message}`)
  }

  return data as { success: boolean; effective_taxonomy_id: string }
}

/**
 * Fetches deterministic objection analytics summary.
 */
export async function getObjectionSummary(
  db: SupabaseClient,
  accountId: string,
  options?: {
    from?: string | null
    to?: string | null
    catalogItemId?: string | null
    sellerUserId?: string | null
  }
): Promise<ObjectionSummaryResult> {
  const { data, error } = await db.rpc('get_objection_summary', {
    p_account_id: accountId,
    p_from: options?.from || null,
    p_to: options?.to || null,
    p_catalog_item_id: options?.catalogItemId || null,
    p_seller_user_id: options?.sellerUserId || null,
  })

  if (error || !data) {
    return { total: 0, from: options?.from || '', to: options?.to || '', items: [] }
  }

  return data as ObjectionSummaryResult
}
