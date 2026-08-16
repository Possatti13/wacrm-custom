import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { getWhatsAppProvider } from '@/lib/whatsapp/providers/factory'
import {
  isTemplateCapable,
  isInteractiveCapable,
} from '@/lib/whatsapp/providers/types'

// ------------------------------------------------------------
// Automation-side WhatsApp sender using unified provider layer.
// ------------------------------------------------------------

interface SendTextArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaProvider({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaProvider({ ...args, kind: 'template' })
}

interface SendInteractiveArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
}

export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaProvider({
    ...args,
    kind: 'interactive',
    payload: args.payload,
  })
}

type ProviderSendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })
  | (SendInteractiveArgs & { kind: 'interactive'; payload: InteractiveMessagePayload })

async function sendViaProvider(
  input: ProviderSendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .single()
  if (contactErr || !contact?.phone) {
    throw new Error(`contact phone not found for ${input.contactId}`)
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  const provider = getWhatsAppProvider({
    provider: config.provider,
    phone_number_id: config.phone_number_id,
    waba_id: config.waba_id,
    waha_base_url: config.waha_base_url,
    waha_session_name: config.waha_session_name,
    decrypted_access_token: accessToken,
  })

  let recipient = sanitized
  if (provider.type === 'waha') {
    try {
      const { data: lastInbound } = await db
        .from('messages')
        .select('message_id')
        .eq('conversation_id', input.conversationId)
        .eq('sender_type', 'customer')
        .not('message_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const rawMessageId = lastInbound?.message_id as string | null | undefined
      const match = rawMessageId?.match(/^(?:true|false)_([^_]+)_.+$/)
      if (match?.[1]?.includes('@')) {
        recipient = match[1]
      }
    } catch (err) {
      console.warn('[automations] Could not resolve WAHA chat id from history:', err)
    }
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      if (!isTemplateCapable(provider)) {
        throw new Error('Templates are not supported by the current WhatsApp provider')
      }
      const res = await provider.sendTemplate({
        to: phone,
        templateName: input.templateName,
        language: input.language || 'en_US',
        bodyParams: input.params,
      })
      return res.externalMessageId
    }

    if (input.kind === 'interactive') {
      if (!isInteractiveCapable(provider)) {
        throw new Error('Interactive messages are not supported by the current WhatsApp provider')
      }
      const p = input.payload
      const res = await provider.sendInteractive({
        to: phone,
        type: p.kind === 'buttons' ? 'button' : 'list',
        bodyText: p.body,
        buttons: p.kind === 'buttons' ? p.buttons : undefined,
        sections: p.kind === 'list' ? p.sections : undefined,
        headerText: p.header,
        footerText: p.footer,
      })
      return res.externalMessageId
    }

    const res = await provider.sendText({
      to: phone,
      text: input.text,
    })
    return res.externalMessageId
  }

  let waMessageId = ''
  let workingPhone = recipient

  if (provider.type === 'waha') {
    waMessageId = await attempt(recipient)
  } else {
    const variants = phoneVariants(recipient)
    let lastError: unknown = null

    for (const phoneToTry of variants) {
      try {
        waMessageId = await attempt(phoneToTry)
        workingPhone = phoneToTry
        lastError = null
        break
      } catch (err) {
        lastError = err
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) {
          throw err
        }
      }
    }

    if (lastError) throw lastError
  }

  // Persist working phone back to contact if different
  if (workingPhone !== sanitized && isValidE164(workingPhone)) {
    void db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', input.contactId)
      .eq('account_id', input.accountId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn('[automations] failed to persist working phone variant:', error.message)
        }
      })
  }

  // Insert message record
  const contentText =
    input.kind === 'text'
      ? input.text
      : input.kind === 'template'
        ? `[Template: ${input.templateName}]`
        : `[Interactive: ${input.payload.body}]`

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: input.kind,
    content_text: contentText,
    template_name: input.kind === 'template' ? input.templateName : null,
    message_id: waMessageId,
    status: 'sent',
  })

  if (msgErr) {
    throw new Error(`message sent via provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
