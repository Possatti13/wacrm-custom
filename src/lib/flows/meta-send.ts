import {
  sendInteractiveButtons,
  sendInteractiveList,
  type InteractiveButton,
  type InteractiveListSection,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'
import { getWhatsAppProvider } from '@/lib/whatsapp/providers/factory'
import {
  isInteractiveCapable,
  type MediaKind,
} from '@/lib/whatsapp/providers/types'

// ------------------------------------------------------------
// Flows-side WhatsApp sender (interactive + text + media).
// ------------------------------------------------------------

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  aiGenerated?: boolean
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
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
        .eq('conversation_id', args.conversationId)
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
      console.warn('[flows] Could not resolve WAHA chat id from history:', err)
    }
  }

  const attempt = async (phone: string): Promise<string> => {
    const res = await provider.sendText({
      to: phone,
      text: args.text,
    })
    return res.externalMessageId
  }

  let waMessageId = ''
  let workingPhone = recipient

  if (provider.type === 'waha') {
    waMessageId = await attempt(recipient)
  } else {
    const variants = phoneVariants(sanitized)
    let lastError: unknown = null
    for (const v of variants) {
      try {
        waMessageId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
  }

  if (workingPhone !== sanitized && isValidE164(workingPhone)) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`message sent via provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
}

export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
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
        .eq('conversation_id', args.conversationId)
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
      console.warn('[flows] Could not resolve WAHA chat id from history:', err)
    }
  }

  const attempt = async (phone: string): Promise<string> => {
    const res = await provider.sendMedia({
      to: phone,
      mediaType: args.kind,
      mediaUrl: args.link,
      caption: args.caption,
      fileName: args.filename,
    })
    return res.externalMessageId
  }

  let waMessageId = ''
  let workingPhone = recipient

  if (provider.type === 'waha') {
    waMessageId = await attempt(recipient)
  } else {
    const variants = phoneVariants(sanitized)
    let lastError: unknown = null
    for (const v of variants) {
      try {
        waMessageId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
  }

  if (workingPhone !== sanitized && isValidE164(workingPhone)) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const preview = args.caption?.trim() || `[${args.kind}]`
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`message sent via provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSendInteractivePayload({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: {
      kind: 'buttons',
      body: args.bodyText,
      buttons: args.buttons,
      header: args.headerText,
      footer: args.footerText,
    },
  })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSendInteractivePayload({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: {
      kind: 'list',
      body: args.bodyText,
      button_label: args.buttonLabel,
      sections: args.sections,
      header: args.headerText,
      footer: args.footerText,
    },
  })
}

interface SendInteractivePayloadEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
}

export async function engineSendInteractivePayload(
  args: SendInteractivePayloadEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
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

  if (!isInteractiveCapable(provider)) {
    throw new Error('Interactive messages are not supported by the current WhatsApp provider')
  }

  const attempt = async (phone: string): Promise<string> => {
    const p = args.payload
    if (p.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: p.body,
        headerText: p.header,
        footerText: p.footer,
        buttons: p.buttons,
      })
      return r.messageId
    }

    const r = await sendInteractiveList({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      bodyText: p.body,
      buttonLabel: p.button_label,
      headerText: p.header,
      footerText: p.footer,
      sections: p.sections,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const preview = args.payload.body
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: preview,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`message sent via provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}
