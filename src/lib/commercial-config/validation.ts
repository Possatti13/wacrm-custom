import type {
  AttributeValueType,
  ConfigEntityStatus,
  SelectOption,
  SaveIntentInput,
  SaveAttributeDefinitionInput,
  CommercialAttributeDefinition,
  CommercialIntent,
} from './types'

export class CommercialConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialConfigValidationError'
  }
}

const KEY_REGEX = /^[a-z0-9_]{2,64}$/
const OPTION_KEY_REGEX = /^[a-z0-9_]{1,64}$/
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateUuid(value: unknown, fieldName = 'ID'): string {
  if (!value || typeof value !== 'string' || !UUID_REGEX.test(value.trim())) {
    throw new CommercialConfigValidationError(`Invalid ${fieldName}: must be a valid UUID`)
  }
  return value.trim()
}

export function validateKey(key: unknown, fieldName = 'key'): string {
  if (typeof key !== 'string') {
    throw new CommercialConfigValidationError(`${fieldName} must be a string`)
  }
  const clean = key.trim().toLowerCase()
  if (!KEY_REGEX.test(clean)) {
    throw new CommercialConfigValidationError(
      `Invalid ${fieldName} '${key}': must be 2-64 lowercase alphanumeric and underscore characters (^[a-z0-9_]{2,64}$)`
    )
  }
  return clean
}

export function validateSelectOptions(options: unknown): SelectOption[] {
  if (!Array.isArray(options) || options.length === 0) {
    throw new CommercialConfigValidationError('Select attributes must have a non-empty array of options')
  }

  const seenKeys = new Set<string>()
  return options.map((opt, idx) => {
    if (!opt || typeof opt !== 'object') {
      throw new CommercialConfigValidationError(`Option at index ${idx} must be a non-null object`)
    }
    const keyRaw = (opt as { key?: unknown }).key
    const labelRaw = (opt as { label?: unknown }).label

    if (typeof keyRaw !== 'string') {
      throw new CommercialConfigValidationError(`Option[${idx}].key must be a string`)
    }
    const cleanKey = keyRaw.trim().toLowerCase()
    if (!OPTION_KEY_REGEX.test(cleanKey)) {
      throw new CommercialConfigValidationError(
        `Invalid option key '${keyRaw}' at index ${idx}: must match ^[a-z0-9_]{1,64}$`
      )
    }

    if (seenKeys.has(cleanKey)) {
      throw new CommercialConfigValidationError(`Duplicate option key '${cleanKey}' found in options`)
    }
    seenKeys.add(cleanKey)

    if (typeof labelRaw !== 'string' || labelRaw.trim().length === 0) {
      throw new CommercialConfigValidationError(`Option[${idx}].label is required and cannot be empty`)
    }

    return {
      key: cleanKey,
      label: labelRaw.trim(),
    }
  })
}

export function validateStatus(status: unknown): ConfigEntityStatus {
  if (status === undefined || status === null) return 'active'
  if (typeof status !== 'string' || !['active', 'inactive', 'archived'].includes(status)) {
    throw new CommercialConfigValidationError("Status must be 'active', 'inactive', or 'archived'")
  }
  return status as ConfigEntityStatus
}

export function validateSaveIntent(input: SaveIntentInput): SaveIntentInput {
  if (!input || typeof input !== 'object') {
    throw new CommercialConfigValidationError('Input must be a non-null object')
  }

  const cleanKey = validateKey(input.key, 'intent.key')
  if (!input.label || typeof input.label !== 'string' || input.label.trim().length === 0) {
    throw new CommercialConfigValidationError('Intent label is required')
  }

  return {
    id: input.id ? validateUuid(input.id, 'id') : undefined,
    key: cleanKey,
    label: input.label.trim(),
    description: typeof input.description === 'string' ? input.description.trim() : null,
    status: validateStatus(input.status),
    sort_order: typeof input.sort_order === 'number' ? input.sort_order : 0,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    change_summary: input.change_summary?.trim(),
  }
}

export function validateSaveAttributeDefinition(
  input: SaveAttributeDefinitionInput
): SaveAttributeDefinitionInput {
  if (!input || typeof input !== 'object') {
    throw new CommercialConfigValidationError('Input must be a non-null object')
  }

  const cleanKey = validateKey(input.key, 'attribute.key')
  if (!input.label || typeof input.label !== 'string' || input.label.trim().length === 0) {
    throw new CommercialConfigValidationError('Attribute label is required')
  }

  const validTypes: AttributeValueType[] = [
    'text',
    'number',
    'boolean',
    'date',
    'single_select',
    'multi_select',
  ]

  if (!validTypes.includes(input.value_type)) {
    throw new CommercialConfigValidationError(
      `Invalid attribute value_type: must be one of ${validTypes.join(', ')}`
    )
  }

  let options: SelectOption[] = []
  if (input.value_type === 'single_select' || input.value_type === 'multi_select') {
    options = validateSelectOptions(input.options)
  }

  return {
    id: input.id ? validateUuid(input.id, 'id') : undefined,
    key: cleanKey,
    label: input.label.trim(),
    description: typeof input.description === 'string' ? input.description.trim() : null,
    value_type: input.value_type,
    options,
    status: validateStatus(input.status),
    sort_order: typeof input.sort_order === 'number' ? input.sort_order : 0,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    change_summary: input.change_summary?.trim(),
  }
}

/**
 * Validates lead profile attributes against the active commercial attribute definitions
 */
export function validateLeadProfileAttributes(
  definitions: CommercialAttributeDefinition[],
  attributes: Record<string, unknown>
): Record<string, unknown> {
  if (!attributes || typeof attributes !== 'object') {
    return {}
  }

  const defMap = new Map<string, CommercialAttributeDefinition>()
  for (const def of definitions) {
    defMap.set(def.key, def)
  }

  const validated: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) {
      continue
    }

    const def = defMap.get(key)
    if (!def) {
      // Attribute key is not defined for this tenant
      throw new CommercialConfigValidationError(
        `Unknown attribute key '${key}' is not defined in tenant configuration`
      )
    }

    if (def.status !== 'active') {
      throw new CommercialConfigValidationError(
        `Attribute definition '${key}' is not active (status: ${def.status})`
      )
    }

    switch (def.value_type) {
      case 'text':
        if (typeof value !== 'string') {
          throw new CommercialConfigValidationError(`Attribute '${key}' must be a string`)
        }
        validated[key] = value.trim()
        break

      case 'number':
        const num = typeof value === 'number' ? value : Number(value)
        if (isNaN(num)) {
          throw new CommercialConfigValidationError(`Attribute '${key}' must be a valid number`)
        }
        validated[key] = num
        break

      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new CommercialConfigValidationError(`Attribute '${key}' must be a boolean (true/false)`)
        }
        validated[key] = value
        break

      case 'date':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          throw new CommercialConfigValidationError(
            `Attribute '${key}' must be a valid ISO date string (YYYY-MM-DD)`
          )
        }
        validated[key] = value.trim()
        break

      case 'single_select': {
        if (typeof value !== 'string') {
          throw new CommercialConfigValidationError(`Attribute '${key}' must be a string option key`)
        }
        const cleanVal = value.trim().toLowerCase()
        const opt = def.options.find((o) => o.key === cleanVal)
        if (!opt) {
          throw new CommercialConfigValidationError(
            `Invalid option '${value}' for attribute '${key}'. Valid option keys: ${def.options.map((o) => o.key).join(', ')}`
          )
        }
        validated[key] = cleanVal
        break
      }

      case 'multi_select': {
        if (!Array.isArray(value)) {
          throw new CommercialConfigValidationError(`Attribute '${key}' must be an array of option keys`)
        }
        const validKeys = new Set(def.options.map((o) => o.key))
        const selectedList: string[] = []
        for (const item of value) {
          if (typeof item !== 'string') {
            throw new CommercialConfigValidationError(`Attribute '${key}' items must be strings`)
          }
          const cleanItem = item.trim().toLowerCase()
          if (!validKeys.has(cleanItem)) {
            throw new CommercialConfigValidationError(
              `Invalid option '${item}' in multi_select attribute '${key}'`
            )
          }
          selectedList.push(cleanItem)
        }
        validated[key] = selectedList
        break
      }
    }
  }

  return validated
}

/**
 * Validates that an assigned current_intent matches an active intent in the account
 */
export function validateCurrentIntentAssignment(
  intents: CommercialIntent[],
  currentIntent: string | null | undefined
): string | null {
  if (!currentIntent || typeof currentIntent !== 'string' || currentIntent.trim().length === 0) {
    return null
  }

  const clean = currentIntent.trim().toLowerCase()
  const intent = intents.find((i) => i.key === clean)

  if (!intent) {
    throw new CommercialConfigValidationError(
      `Intent '${currentIntent}' is not recognized in tenant commercial intents`
    )
  }

  if (intent.status !== 'active') {
    throw new CommercialConfigValidationError(
      `Intent '${currentIntent}' is not active (status: ${intent.status})`
    )
  }

  return clean
}
