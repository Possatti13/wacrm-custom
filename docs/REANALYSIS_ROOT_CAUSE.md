# Reanálise comercial — investigação anterior à correção

Candidate investigado: `cf658ccdfa844a88f603daef53f1ac090b6d2cd3`.

## Causa raiz comprovada

O tenant staging `8eb73d03-a960-48f6-8f04-1b4ecb1c0604` não tem registro em `tenant_intelligence_settings`, nem credencial em `ai_configs`. A leitura com service role e a leitura com o owner concordam: registro ausente, sem erro de RLS. A conta pertence a um owner autenticado.

Esse tenant foi provisionado como ambiente de inspeção dos cinco cenários: foram copiados perfis e scores históricos, não configuração operacional/credenciais. `isolate-staging.ts` comprova essa origem. Não é entitlement ou feature flag de ambiente, nem bloqueio de role/middleware. O gate é configuração explícita por tenant no RPC `claim_internal_ai_request` (migration 064): ausência, `enabled=false` ou `invocation_mode=off` causam SQLSTATE `55000` antes de criar a requisição. Defaults e GET de configurações mantêm inteligência desligada; provisionamento invite-only não deve habilitá-la automaticamente.

O serviço converte todo erro RPC em `Error`, descartando o código. A rota usa `toErrorResponse`, que converte erros desconhecidos em HTTP 500. Inteligência deliberadamente desabilitada deve retornar uma recusa explícita (403, código estável), sem conceder a função ao usuário nem alterar o gate no banco.

## Segundo problema comprovado

`executeOnDemandAiAction` cria um cliente de worker para completar/falhar a requisição, mas passa o cliente do usuário para extração, projeção e score. Migration 056 reserva `claim_conversation_analysis_run`, `persist_conversation_analysis_batch` e `project_contact_commercial_state` ao `service_role`. Uma chamada autenticada com todos os parâmetros, alvo inexistente e sem qualquer escrita retornou SQLSTATE `42501`: `permission denied for function claim_conversation_analysis_run`. O caminho de worker existente já executa extração/projeção com cliente privilegiado; a chamada manual diverge.

O código também considera extração `{processed:false, reason:'failed'}` como análise concluída e ignora erros de projeção/score com `.catch(() => null)`. Esse caminho permite falso sucesso sem persistência. A correção precisa preservar validação de caller/tenant/target no claim autenticado e somente então usar worker para processamento. Falhas reais não podem concluir a requisição nem retornar HTTP 200 de sucesso.

## Contrato operacional esperado

Um administrador/owner configura explicitamente inteligência, modo de invocação e provedor/modelo com credencial compatível via contrato vigente de configurações. `on_demand` habilita somente ações manuais. O RPC autenticado valida membership, identidade e ownership do alvo; worker executa funções internas já protegidas. Somente extração/persistência/projeção/score concluídos podem marcar sucesso. Regras e algoritmos comerciais permanecem intactos.

## Produção — auditoria somente leitura

Projeto `vutyeaytyksciiykddyh`, tenant `3408b625-3ccd-4368-a1d6-89001083d983`: `enabled=true`, `invocation_mode=smart_auto`, Gemini `gemini-3.5-flash-lite`, timeout 25000, limites diário 1000/mensal 25000, credencial Gemini presente. Nenhum `analyze_conversation` registrado em `internal_ai_requests` na leitura atual. Há runs automáticos concluídos e runs recentes falhos por imutabilidade de insights. Esses registros não certificam a reanálise manual nem serão modificados nesta tarefa. Nenhuma credencial foi exibida ou copiada da produção.

Evidências anteriores a qualquer mudança de configuração: `artifacts/reanalysis-certification/staging-root-cause.json` e `production-read-only.json`.

## Menor correção planejada, somente staging

Arquivos: `src/lib/intelligence/on-demand.ts` (cliente de worker correto e propagação de falhas); `src/lib/intelligence/errors.ts` (erros seguros de domínio); `src/app/api/ai/on-demand/route.ts` (status explícito); testes focados do serviço/rota; script de certificação staging isolado e relatório.

Não alterar Auth, grants/RLS, scoring, UI aprovada ou produção. Completar configuração de IA do tenant de staging pelo RPC vigente, usando credencial já existente exclusivamente no projeto staging e modo manual. Preparar uma conversa temporária para análise real, com cleanup confiável, preservando os cinco registros aprovados. Configuração comercial/scoring de certificação deve usar contratos existentes e não forjar scores/perfis.

## Complemento após reprodução real e inspeção SQL

Após configurar o tenant pelo RPC vigente, o candidate anterior retornou novamente HTTP 500: `claimAnalysisRun failed: permission denied for function claim_conversation_analysis_run`. Isso confirma o segundo problema por chamada real no endereço público, não somente inspeção de código.

O patch do servidor permitiu quatro chamadas reais de análise (duas etapas, dois tenants), com persistência de resumo, próxima ação, intenção e urgência. O scoring do tenant operacional existente também persistiu resultado real. Não foi criada ou alterada configuração de scoring no tenant dos cinco fixtures: nesse tenant, scoring operacional não está configurado; os cinco scores históricos foram preservados.

A auditoria adicional comprovou um terceiro defeito limitado à persistência de observações duplicadas. A função vigente de migration 075 faz `ON CONFLICT ... DO UPDATE` de campos factuais/proveniência, enquanto o trigger de migration 047 proíbe essa alteração. Definição real de staging antes: hash `8b79c1a47485a91f5e8998bc798edfcb`, ACL `{postgres=X/postgres,service_role=X/postgres}`. Um teste PostgreSQL local usando os corpos reais reproduziu SQLSTATE 23514 com duas observações de mesma identidade/evidência.

Correção adicional comprovadamente necessária: migration **095**, idempotente e com precondição, muda somente esse upsert para atualizar `updated_at`, preservando fatos originais, evidências, checkpoints, projeção, dirty-state e ACL. Não altera tabelas, schema estrutural, triggers, RLS ou grants. Aplicada **somente no projeto staging** pelo painel `crm-whatsapp-staging`, ref `pxpnkaakurjwpfuezpob`. Definição após: hash `90612e3e4e8e2a5e554d0f779bd914db`, mesma ACL. Produção permanece com sua configuração/função anterior, sem aplicação de SQL.

O cleanup de probes analisados respeita as referências de evidência e os ledgers imutáveis: remove apenas marcadores/evidências/conversas descartáveis de certificação; mantém o contato de auditoria quando existe histórico de scoring imutável. Nenhum trigger/ledger é desabilitado ou apagado para viabilizar cleanup. O hash A–E permanece igual antes/depois.
