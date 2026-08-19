import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectionRunResult } from './types'
import { projectContactCommercialState } from './repository'

export interface ProjectCommercialStateJobPayload {
  accountId: string
  contactId: string
  triggerSource?: string
}

export interface ProcessProjectorJobResult {
  success: boolean
  outcome?: 'applied' | 'no_op'
  projection_run_id?: string
  error?: string
}

export async function handleProjectCommercialStateJob(
  payload: ProjectCommercialStateJobPayload,
  db: SupabaseClient
): Promise<ProcessProjectorJobResult> {
  if (!payload || !payload.accountId || !payload.contactId) {
    return { success: true, outcome: 'no_op', error: 'invalid_payload' }
  }

  try {
    const result: ProjectionRunResult = await projectContactCommercialState(db, {
      accountId: payload.accountId,
      contactId: payload.contactId,
      triggerSource: payload.triggerSource || 'pgmq_job',
    })

    return {
      success: true,
      outcome: result.outcome,
      projection_run_id: result.projection_run_id,
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: errorMsg,
    }
  }
}
