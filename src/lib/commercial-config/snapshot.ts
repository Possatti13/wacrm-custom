import { createHash } from 'crypto'
import type {
  CommercialIntent,
  CommercialAttributeDefinition,
  TenantCommercialContext,
  TenantCommercialTerminology,
  CanonicalConfigSnapshot,
} from './types'

export function buildCanonicalSnapshot(data: {
  intents: CommercialIntent[]
  attributes: CommercialAttributeDefinition[]
  context?: TenantCommercialContext | null
  terminology?: TenantCommercialTerminology | null
}): CanonicalConfigSnapshot {
  const sortedIntents = [...(data.intents || [])]
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.key.localeCompare(b.key)
    })
    .map((i) => ({
      id: i.id,
      key: i.key,
      label: i.label,
      description: i.description ?? null,
      status: i.status,
      sort_order: i.sort_order,
      metadata: i.metadata && typeof i.metadata === 'object' ? i.metadata : {},
    }))

  const sortedAttributes = [...(data.attributes || [])]
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.key.localeCompare(b.key)
    })
    .map((a) => {
      const sortedOptions = [...(a.options || [])].sort((x, y) => x.key.localeCompare(y.key))
      return {
        id: a.id,
        key: a.key,
        label: a.label,
        description: a.description ?? null,
        value_type: a.value_type,
        options: sortedOptions,
        status: a.status,
        sort_order: a.sort_order,
        metadata: a.metadata && typeof a.metadata === 'object' ? a.metadata : {},
      }
    })

  const ctx = data.context || null
  const term = data.terminology || null

  return {
    schemaVersion: 1,
    intents: sortedIntents,
    attributes: sortedAttributes,
    context: {
      company_description: ctx?.company_description ?? null,
      commercial_objectives: ctx?.commercial_objectives ?? null,
      qualification_guidelines: ctx?.qualification_guidelines ?? null,
      prohibited_assumptions: ctx?.prohibited_assumptions ?? null,
      terminology_notes: ctx?.terminology_notes ?? null,
      metadata: ctx?.metadata && typeof ctx.metadata === 'object' ? ctx.metadata : {},
    },
    terminology: {
      contact_label_singular: term?.contact_label_singular || 'Contato',
      contact_label_plural: term?.contact_label_plural || 'Contatos',
      catalog_item_label_singular: term?.catalog_item_label_singular || 'Produto / Serviço',
      catalog_item_label_plural: term?.catalog_item_label_plural || 'Produtos e Serviços',
      metadata: term?.metadata && typeof term.metadata === 'object' ? term.metadata : {},
    },
  }
}

export function computeSnapshotHash(snapshot: CanonicalConfigSnapshot): string {
  const jsonString = JSON.stringify(snapshot)
  return createHash('sha256').update(jsonString, 'utf8').digest('hex')
}
