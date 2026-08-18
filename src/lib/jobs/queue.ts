import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { JobEnvelope, QueueMessage, WhatsAppInboundJobEnvelope } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function getDefaultAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export interface JobQueue {
  enqueueWhatsAppInboundBatch(
    envelopes: WhatsAppInboundJobEnvelope[],
    db?: SupabaseClient
  ): Promise<number[]>

  readWhatsAppInbound(
    vt: number,
    limit: number,
    db?: SupabaseClient
  ): Promise<Array<QueueMessage<unknown>>>

  archiveWhatsAppInbound(
    msgId: number,
    db?: SupabaseClient
  ): Promise<boolean>

  setWhatsAppInboundVisibility(
    msgId: number,
    vt: number,
    db?: SupabaseClient
  ): Promise<string>

  deadLetterWhatsAppInbound(
    msgId: number,
    envelope: unknown,
    errorInfo: Record<string, unknown>,
    db?: SupabaseClient
  ): Promise<boolean>
}

export class PgmqJobQueue implements JobQueue {
  async enqueueWhatsAppInboundBatch(
    envelopes: WhatsAppInboundJobEnvelope[],
    client?: SupabaseClient
  ): Promise<number[]> {
    if (envelopes.length === 0) return []

    const db = client || getDefaultAdminClient()
    const { data, error } = await db.rpc('enqueue_whatsapp_inbound_batch', {
      p_messages: envelopes,
    })

    if (error) {
      throw new Error(`enqueue_whatsapp_inbound_batch failed: ${error.message}`)
    }

    return (data || []).map((id: string | number) => Number(id))
  }

  async readWhatsAppInbound(
    vt: number,
    limit: number,
    client?: SupabaseClient
  ): Promise<Array<QueueMessage<unknown>>> {
    const db = client || getDefaultAdminClient()
    const { data, error } = await db.rpc('read_whatsapp_inbound', {
      p_vt: vt,
      p_limit: limit,
    })

    if (error) {
      throw new Error(`read_whatsapp_inbound failed: ${error.message}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).map((row: any) => ({
      msg_id: Number(row.msg_id),
      read_ct: Number(row.read_ct),
      enqueued_at: String(row.enqueued_at),
      vt: String(row.vt),
      message: row.message as JobEnvelope<unknown>,
    }))
  }

  async archiveWhatsAppInbound(
    msgId: number,
    client?: SupabaseClient
  ): Promise<boolean> {
    const db = client || getDefaultAdminClient()
    const { data, error } = await db.rpc('archive_whatsapp_inbound', {
      p_msg_id: msgId,
    })

    if (error) {
      throw new Error(`archive_whatsapp_inbound failed for msg_id ${msgId}: ${error.message}`)
    }

    return Boolean(data)
  }

  async setWhatsAppInboundVisibility(
    msgId: number,
    vt: number,
    client?: SupabaseClient
  ): Promise<string> {
    const db = client || getDefaultAdminClient()
    const { data, error } = await db.rpc('set_whatsapp_inbound_visibility', {
      p_msg_id: msgId,
      p_vt: vt,
    })

    if (error) {
      throw new Error(`set_whatsapp_inbound_visibility failed for msg_id ${msgId}: ${error.message}`)
    }

    return String(data)
  }

  async deadLetterWhatsAppInbound(
    msgId: number,
    envelope: unknown,
    errorInfo: Record<string, unknown>,
    client?: SupabaseClient
  ): Promise<boolean> {
    const db = client || getDefaultAdminClient()
    const { data, error } = await db.rpc('dead_letter_whatsapp_inbound', {
      p_msg_id: msgId,
      p_message: envelope,
      p_error_info: errorInfo,
    })

    if (error) {
      throw new Error(`dead_letter_whatsapp_inbound failed for msg_id ${msgId}: ${error.message}`)
    }

    return Boolean(data)
  }
}

export const defaultJobQueue = new PgmqJobQueue()
