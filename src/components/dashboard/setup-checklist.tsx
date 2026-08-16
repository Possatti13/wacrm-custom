"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Circle,
  Contact,
  ListChecks,
  MessageSquare,
  QrCode,
  Rocket,
  Zap,
} from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface SetupState {
  whatsappConnected: boolean
  hasConversation: boolean
  hasContact: boolean
  hasAutomation: boolean
  hasQuickReply: boolean
  hasPipeline: boolean
}

const EMPTY_STATE: SetupState = {
  whatsappConnected: false,
  hasConversation: false,
  hasContact: false,
  hasAutomation: false,
  hasQuickReply: false,
  hasPipeline: false,
}

interface SetupItem {
  key: keyof SetupState
  title: string
  description: string
  href: string
  cta: string
  icon: typeof QrCode
}

const ITEMS: SetupItem[] = [
  {
    key: 'whatsappConnected',
    title: 'Conectar WhatsApp',
    description: 'Escaneie o QR Code e deixe a sessão WAHA online.',
    href: '/settings?tab=whatsapp',
    cta: 'Abrir conexão',
    icon: QrCode,
  },
  {
    key: 'hasConversation',
    title: 'Testar conversa',
    description: 'Envie uma mensagem de teste e responda pelo CRM.',
    href: '/inbox',
    cta: 'Abrir conversas',
    icon: MessageSquare,
  },
  {
    key: 'hasContact',
    title: 'Organizar contatos',
    description: 'Confirme contatos, tags e dados básicos do cliente.',
    href: '/contacts',
    cta: 'Ver contatos',
    icon: Contact,
  },
  {
    key: 'hasPipeline',
    title: 'Configurar funil',
    description: 'Use o funil para acompanhar oportunidades e follow-ups.',
    href: '/pipelines',
    cta: 'Abrir funil',
    icon: ListChecks,
  },
  {
    key: 'hasAutomation',
    title: 'Ativar primeira automação',
    description: 'Comece por boas-vindas, fora do horário ou qualificação.',
    href: '/automations',
    cta: 'Criar automação',
    icon: Zap,
  },
  {
    key: 'hasQuickReply',
    title: 'Criar respostas rápidas',
    description: 'Prepare mensagens prontas para acelerar o atendimento.',
    href: '/settings?tab=quick-replies',
    cta: 'Configurar respostas',
    icon: Bot,
  },
]

export function SetupChecklist() {
  const [state, setState] = useState<SetupState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)

  const completed = useMemo(
    () => ITEMS.filter((item) => state[item.key]).length,
    [state],
  )
  const progress = Math.round((completed / ITEMS.length) * 100)
  const nextItem = ITEMS.find((item) => !state[item.key]) ?? null

  const loadState = useCallback(async () => {
    setLoading(true)
    const db = createClient()

    try {
      const [whatsapp, conversations, contacts, automations, quickReplies, pipelines] = await Promise.all([
        db.from('whatsapp_config').select('provider,status').limit(1),
        db.from('conversations').select('id').limit(1),
        db.from('contacts').select('id').limit(1),
        db.from('automations').select('id').limit(1),
        db.from('quick_replies').select('id').limit(1),
        db.from('pipelines').select('id').limit(1),
      ])

      const whatsappRow = whatsapp.data?.[0] as { provider?: string; status?: string } | undefined
      setState({
        whatsappConnected: whatsappRow?.status === 'connected',
        hasConversation: (conversations.data?.length ?? 0) > 0,
        hasContact: (contacts.data?.length ?? 0) > 0,
        hasAutomation: (automations.data?.length ?? 0) > 0,
        hasQuickReply: (quickReplies.data?.length ?? 0) > 0,
        hasPipeline: (pipelines.data?.length ?? 0) > 0,
      })
    } catch (err) {
      console.error('[setup-checklist] load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadState()
  }, [loadState])

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Rocket className="size-5 text-primary" />
              Checklist de implantação
            </CardTitle>
            <CardDescription className="mt-1">
              Use este passo a passo para deixar um novo cliente pronto para atendimento.
            </CardDescription>
          </div>
          <div className="rounded-full border border-border bg-background px-3 py-1 text-sm font-medium text-foreground">
            {loading ? 'verificando...' : `${completed}/${ITEMS.length} pronto`}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${loading ? 15 : progress}%` }}
          />
        </div>

        {nextItem && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/70 p-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Próximo passo</p>
              <p className="font-medium text-foreground">{nextItem.title}</p>
            </div>
            <Link
              href={nextItem.href}
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {nextItem.cta}
            </Link>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ITEMS.map((item) => {
            const done = state[item.key]
            const Icon = item.icon
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  'group rounded-xl border bg-background/80 p-3 transition-colors hover:bg-muted/60',
                  done ? 'border-emerald-700/30' : 'border-border',
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2 className="size-4 text-emerald-400" />
                      ) : (
                        <Circle className="size-4 text-muted-foreground" />
                      )}
                      <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
