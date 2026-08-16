import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  AUTOMATION_PLAYBOOKS,
  AUTOMATION_TEMPLATES,
  type AutomationPlaybookSlug,
} from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'

export async function GET() {
  return NextResponse.json({ playbooks: Object.values(AUTOMATION_PLAYBOOKS) })
}

export async function POST(request: Request) {
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()

  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  const playbookSlug = body?.playbook as AutomationPlaybookSlug | undefined
  const playbook = playbookSlug ? AUTOMATION_PLAYBOOKS[playbookSlug] : null

  if (!playbook) {
    return NextResponse.json({ error: 'Invalid playbook.' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const templateNames = playbook.templates.map((slug) => AUTOMATION_TEMPLATES[slug].name)
  const { data: existing, error: existingError } = await admin
    .from('automations')
    .select('name')
    .eq('account_id', accountId)
    .in('name', templateNames)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const existingNames = new Set((existing ?? []).map((row) => row.name as string))
  const created: Array<{ id: string; name: string }> = []
  const skipped: string[] = []

  for (const templateSlug of playbook.templates) {
    const template = AUTOMATION_TEMPLATES[templateSlug]
    if (existingNames.has(template.name)) {
      skipped.push(template.name)
      continue
    }

    const { data: automation, error: insertErr } = await admin
      .from('automations')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name: template.name,
        description: template.description,
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config ?? {},
        is_active: false,
      })
      .select('id,name')
      .single()

    if (insertErr || !automation) {
      return NextResponse.json(
        { error: insertErr?.message ?? `Failed to create ${template.name}` },
        { status: 500 },
      )
    }

    const stepsErr = await insertSteps(
      automation.id,
      template.steps as unknown as BuilderStepInput[],
    )
    if (stepsErr) {
      return NextResponse.json({ error: stepsErr }, { status: 500 })
    }

    created.push({ id: automation.id, name: automation.name })
  }

  return NextResponse.json({
    playbook: playbook.slug,
    created,
    skipped,
  })
}
