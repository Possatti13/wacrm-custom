# WA CRM Custom 2.0 Product Review & Implementation Plan

> **For Hermes:** Use this as the product/UX roadmap for Phase 2. Do not implement all at once. Execute in short, validated increments.

**Goal:** Turn the current WA CRM custom app into an intuitive, powerful, client-ready WhatsApp automation CRM for one client/workspace per deployment.

**Architecture:** Keep the current account-scoped CRM model. Do not build multi-client agency dashboard now. Focus on a polished single-client delivery package: connection, inbox, contacts, simple automations, media, AI-assisted support, and operational dashboards.

**Tech Stack:** Next.js 16, Supabase, WAHA provider, Meta provider kept as optional, next-intl, Supabase Storage, existing Automations/Flows/AI modules.

---

## Current Context

### Already working

- WAHA provider integrated for one workspace/account.
- Inbound WhatsApp text arrives in the CRM inbox.
- Outbound text replies work through WAHA, including `@lid` chats.
- Basic PT-BR locale exists.
- CRM already includes major modules: Dashboard, Inbox, Contacts, Pipelines, Broadcasts, Automations, Flows, AI Agents, Settings.

### Current product shape

The app is technically rich, but for a normal client it exposes too much too early. The biggest risk is not lack of features — it is cognitive overload.

Current UX score: **6.5/10**

Main reasons:

1. Too many navigation items for a first-time client.
2. Automations and Flows overlap conceptually.
3. WhatsApp setup still feels technical.
4. WAHA is working but not fully surfaced in UI as a first-class provider.
5. Media via WAHA is not yet implemented.
6. AI is powerful but not guided enough for a business owner.
7. Some areas are useful later, but distract from the core value now.

Target UX score for 2.0: **9/10**

---

## Product Positioning for 2.0

**Simple sentence:**

> A WhatsApp CRM that lets a small business receive messages, organize leads, automate first responses, and follow up with customers from one clean panel.

**For Léo / Wave offer:**

> Setup de atendimento WhatsApp com CRM, automações e IA leve para captação, qualificação e follow-up.

**Do not position as:**

- Full enterprise CRM.
- Multi-client SaaS dashboard.
- Complex chatbot builder.
- n8n replacement.

---

## Feature Classification

### Core 2.0 — keep visible and polish

1. **Inbox**
   - Primary operational screen.
   - Must feel fast, reliable, and WhatsApp-native.
   - Needs text + image/document support via WAHA.

2. **Contacts**
   - Essential for client/customer organization.
   - Keep tags, notes, custom fields, import CSV.

3. **Automações Simples**
   - Main selling point.
   - Should focus on templates and guided recipes.
   - Examples: boas-vindas, fora do horário, qualificar lead, follow-up.

4. **Configuração WhatsApp**
   - Must become non-technical.
   - Client should understand status: conectado / precisa escanear QR / erro.

5. **Respostas rápidas**
   - Very high-value low-complexity feature.
   - Should be easy to create and use inside Inbox.

6. **Pipelines**
   - Useful if framed as “Funil de vendas”.
   - Keep simple: Novo lead → Qualificado → Proposta → Negociação → Ganho.

7. **Dashboard**
   - Useful as home/status page.
   - Should focus on operational metrics, not complex analytics.

### Powerful but should be hidden/advanced

1. **Flows**
   - Powerful but overlaps with Automations.
   - For 2.0, hide behind “Avançado” or merge mentally into “Automações”.
   - Keep for menu/button workflows, but not as a primary nav item for beginners.

2. **Broadcasts / Disparos**
   - Useful but dangerous/confusing without templates, consent, and deliverability explanation.
   - Keep visible only after WhatsApp connection + templates are configured.
   - Consider renaming to “Campanhas”.

3. **AI Agents**
   - Keep, but rename and simplify.
   - Better label: “Assistente IA” or “IA do Atendimento”.
   - Hide Playground/Usage from basic users.

4. **API Keys**
   - Advanced/developer feature.
   - Hide under Settings → Avançado.

5. **Team Members**
   - Useful later.
   - Keep in Settings, not primary nav.

### Postpone for after 2.0

1. Multi-client agency dashboard.
2. Billing/subscriptions.
3. Multi-number per workspace.
4. Full product catalog with inventory.
5. Advanced analytics.
6. Multi-channel beyond WhatsApp.

---

## Recommended 2.0 Navigation

### Current nav

- Dashboard
- Inbox
- Notifications
- Contacts
- Pipelines
- Broadcasts
- Automations
- Flows
- AI Agents
- Settings

### Proposed 2.0 nav

Primary:

1. **Início**
2. **Conversas**
3. **Contatos**
4. **Funil**
5. **Automações**
6. **Campanhas**
7. **Assistente IA**
8. **Configurações**

Hide or merge:

- Notifications → badge/area inside Conversas or top bar.
- Flows → inside Automações → Avançado.
- Broadcasts → rename Campanhas.
- Pipelines → rename Funil.
- AI Agents → Assistente IA.

---

## Proposed 2.0 User Journey

### First login / setup wizard

A new client should land on a setup checklist, not an empty dashboard.

Checklist:

1. Conectar WhatsApp.
2. Enviar mensagem de teste.
3. Criar primeira automação.
4. Criar respostas rápidas.
5. Configurar funil.
6. Convidar equipe, optional.

Files likely involved:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/dashboard/*`
- `src/components/settings/whatsapp-config.tsx`
- New: `src/components/onboarding/setup-checklist.tsx`

Validation:

- Fresh account sees setup checklist.
- Connected account sees operational dashboard.

---

## Key 2.0 Workstreams

## Workstream 1 — Make WAHA first-class in Settings

### Problem

The settings UI was originally Meta-first. WAHA works in backend but the UI still feels technical and Meta-oriented.

### Target

A client-friendly WhatsApp settings page:

- Provider selector: WAHA / Meta.
- WAHA session status: Conectado, Aguardando QR, Desconectado.
- QR code visible in the app.
- Button: Reiniciar sessão.
- Button: Testar envio.
- Webhook status.

### Likely files

- `src/components/settings/whatsapp-config.tsx`
- `src/app/api/whatsapp/config/route.ts`
- `src/lib/whatsapp/waha-api.ts`
- New route: `src/app/api/whatsapp/waha/qr/route.ts`
- New route: `src/app/api/whatsapp/waha/session/route.ts`

### Priority

P0.

---

## Workstream 2 — Add WAHA media support

### Problem

The app has UI/data model for images, videos, audio, documents. Meta path supports media, but the WAHA adapter currently only sends text.

### Target

Allow a client/agent to send product images, PDFs, photos, and audio through Inbox using WAHA.

### Scope for 2.0

P0:

- Send image with caption.
- Send document/PDF with filename.
- Receive inbound image/document and show in thread.

P1:

- Send audio/voice.
- Send video.

### Likely files

- `src/lib/whatsapp/waha-api.ts`
- `src/lib/whatsapp/send-message.ts`
- `src/app/api/whatsapp/waha/webhook/route.ts`
- `src/components/inbox/message-composer.tsx`
- `src/components/inbox/message-bubble.tsx`
- `src/lib/storage/upload-media.ts`

### WAHA implementation notes

- Add `sendWahaMediaMessage(config, recipient, kind, mediaUrl, caption, filename)`.
- Resolve original `@lid` chatId as currently done for text.
- Persist `content_type`, `media_url`, `content_text`, `filename` if schema supports it or keep filename in content text for now.
- In webhook, detect WAHA media payload shape and download/store/forward media URL.

### Priority

P0 for product/client use.

---

## Workstream 3 — Simplify Automations into recipes

### Problem

The automation builder is powerful but advanced. Normal clients need guided recipes.

### Target

Automações page should feel like:

- “Escolha uma automação pronta”
- “Personalize texto e horário”
- “Ative”

Not like a technical workflow builder first.

### Recommended recipes

1. **Boas-vindas**
   - Trigger: primeira mensagem recebida.
   - Action: enviar texto.
   - Optional: adicionar tag “Novo lead”.

2. **Fora do horário**
   - Trigger: nova mensagem.
   - Condition: horário fora do expediente.
   - Action: responder previsão.

3. **Qualificar lead**
   - Trigger: palavra-chave or primeira mensagem.
   - Action: perguntas rápidas/buttons.
   - Action: tag based on response.

4. **Follow-up 24h**
   - Trigger: conversa sem resposta.
   - Wait.
   - Send follow-up.

5. **Encaminhar para humano**
   - Trigger: palavra-chave (“atendente”, “humano”, “vendedor”).
   - Action: atribuir conversa / pausar IA.

### Likely files

- `src/app/(dashboard)/automations/page.tsx`
- `src/components/automations/automation-builder.tsx`
- `src/lib/automations/templates.ts`
- `messages/pt-BR.json`

### Priority

P0.

---

## Workstream 4 — Unify “Automations” and “Flows” mentally

### Problem

There are two automation concepts:

- Automations: trigger/action workflow.
- Flows: button/list conversation graph.

For clients, both are “automações”.

### Target

Keep Flows engine, but present it as advanced automation type.

UI proposal:

- Main nav: **Automações** only.
- Tabs inside:
  - Modelos simples
  - Minhas automações
  - Fluxos com botões — Avançado
  - Logs

### Likely files

- `src/components/layout/sidebar.tsx`
- `src/app/(dashboard)/automations/page.tsx`
- `src/app/(dashboard)/flows/page.tsx`
- `src/components/flows/*`

### Priority

P1.

---

## Workstream 5 — Make Inbox the hero product

### Problems

Inbox works, but should become the daily command center.

### Target improvements

1. Stronger contact sidebar:
   - Tags.
   - Notes.
   - Pipeline stage.
   - Last automation/flow status.
   - AI status.

2. Message composer:
   - Confirm media works with WAHA.
   - Prominent quick replies.
   - “Enviar produto/imagem” once media exists.

3. Conversation list:
   - Better filters: Todas, Não lidas, Aguardando resposta, Com IA, Com humano.
   - Search by contact, phone, tag.

4. AI handoff clarity:
   - Show if IA is active/paused.
   - One-click “Assumir atendimento”.

### Likely files

- `src/app/(dashboard)/inbox/page.tsx`
- `src/components/inbox/conversation-list.tsx`
- `src/components/inbox/message-thread.tsx`
- `src/components/inbox/message-composer.tsx`
- `src/components/inbox/contact-sidebar.tsx`
- `src/components/inbox/ai-thread-banner.tsx`

### Priority

P0/P1.

---

## Workstream 6 — Simplify AI into “Assistente IA”

### Problem

AI Agents page exposes setup/playground/usage. Good for developers; less clear for business owners.

### Target

Rename and reposition:

- “Agentes de IA” → “Assistente IA”
- Setup becomes “Configurar assistente”
- Playground becomes “Testar respostas”
- Usage hidden under advanced/admin

### Recommended AI modes

1. Draft-only mode:
   - IA helps agent write replies.
   - Lowest risk.

2. Auto-reply mode:
   - IA answers automatically only when no flow handled and no human assigned.
   - Must have clear limits.

3. Knowledge base:
   - FAQs, policies, products.
   - Later: product catalog.

### Likely files

- `src/app/(dashboard)/agents/page.tsx`
- `src/components/settings/ai-config.tsx`
- `src/components/settings/ai-knowledge.tsx`
- `messages/pt-BR.json`

### Priority

P1.

---

## Workstream 7 — Product/client delivery mode

### Problem

Léo wants a repeatable “new client” setup flow: template app → subdomain → configure from zero.

### Target

Create a visible checklist and hidden technical runbook.

App checklist:

- Brand/name of client.
- WhatsApp connected.
- First automation active.
- Quick replies configured.
- Test message sent/received.

Developer runbook:

- Clone template.
- Create Supabase project.
- Run migrations.
- Set env vars.
- Deploy app.
- Configure WAHA session.
- Connect QR.
- Verify inbox.

### Likely files

- New: `docs/new-client-setup.md`
- New: `scripts/new-client-check.mjs`
- New: `src/components/onboarding/client-setup-checklist.tsx`

### Priority

P1.

---

## Workstream 8 — Dashboard as operational home

### Problem

Dashboard currently has analytics, but for first-time clients it should answer: “Está funcionando? O que precisa da minha atenção?”

### Target cards

1. WhatsApp status.
2. Conversas abertas.
3. Leads novos hoje.
4. Tempo médio de resposta.
5. Automações ativas.
6. Mensagens enviadas hoje.
7. Checklist de setup, if incomplete.

### Likely files

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/dashboard/*`
- `src/app/api/whatsapp/config/route.ts`

### Priority

P1.

---

## Workstream 9 — Copy and localization polish

### Problem

PT-BR exists, but some hardcoded strings remain and some terms should become more product-like.

### Glossary

Use consistently:

- Inbox → Conversas or Caixa de entrada. Prefer **Conversas** for nav.
- Pipelines → Funil.
- Broadcasts → Campanhas.
- Automations → Automações.
- Flows → Fluxos, but only inside advanced automation.
- AI Agents → Assistente IA.
- Deals → Oportunidades or Negócios. Prefer **Oportunidades** for client-friendly language.
- Templates → Modelos.

### Likely files

- `messages/pt-BR.json`
- Search hardcoded strings in `src/**/*.{ts,tsx}`.

### Priority

P0/P1.

---

## Recommended Execution Order

### Sprint 1 — Client-ready foundation

1. WAHA settings UI/status/QR.
2. WAHA media send/receive for image and document.
3. Rename nav/copy for simpler product language.
4. Dashboard setup checklist.

### Sprint 2 — Automation productization

1. Guided automation recipes.
2. Hide Flows behind advanced tab.
3. Improve automation logs/status.
4. Add test automation button.

### Sprint 3 — Inbox power layer

1. Quick replies polish.
2. Contact sidebar improvements.
3. AI active/paused clarity.
4. Filters for conversations.

### Sprint 4 — Client delivery playbook

1. New-client runbook.
2. Environment/template cleanup.
3. Optional per-client branding variables.
4. Deployment checklist.

---

## What Not To Build Yet

- Multi-client agency dashboard.
- Multi-number per workspace.
- Complex billing.
- Full e-commerce/catalog engine.
- Advanced report builder.
- Too many automation node types exposed to basic users.

---

## Acceptance Criteria for WA CRM 2.0

A non-technical client should be able to:

1. Open the app and know if WhatsApp is connected.
2. Receive and reply to messages.
3. Send an image/document from the inbox.
4. Create a welcome automation from a template.
5. Add contacts/tags/notes.
6. Move a lead through a simple funnel.
7. Use quick replies.
8. Understand whether IA is on/off.
9. Know what to do next from the dashboard.

Léo should be able to:

1. Clone/deploy a new client instance.
2. Connect a client WhatsApp by QR.
3. Configure automations in under 1 hour.
4. Demonstrate clear business value in a sales call.
5. Avoid building multi-client platform complexity too early.

---

## Final Product Recommendation

For 2.0, build a **single-client WhatsApp automation CRM** with strong onboarding and media support.

The winning product is not “more features”. It is:

- fast setup,
- reliable WhatsApp connection,
- intuitive inbox,
- simple automations,
- media/product sending,
- guided IA,
- client-ready deployment flow.
