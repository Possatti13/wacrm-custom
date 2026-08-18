// ============================================================
// Queue Configuration & Constants
// ============================================================

export const WHATSAPP_INBOUND_QUEUE = 'whatsapp_inbound' as const
export const WHATSAPP_INBOUND_DLQ = 'whatsapp_inbound_dead' as const

/**
 * Visibility timeout in seconds.
 *
 * Set conservatively to 120 seconds (2 minutes) to ensure that
 * downstream handlers (which may execute external automations,
 * database cascades, or AI replies) complete safely before
 * the message becomes visible to another consumer.
 */
export const WHATSAPP_INBOUND_VISIBILITY_TIMEOUT = 120

/**
 * Maximum number of jobs to fetch in a single worker batch.
 */
export const WHATSAPP_INBOUND_BATCH_SIZE = 10

/**
 * Maximum real execution attempts allowed before routing to DLQ.
 * Attempts 1, 2, and 3 execute the handler.
 * If attempt 3 fails, the message is routed to DLQ.
 */
export const MAX_JOB_ATTEMPTS = 3
