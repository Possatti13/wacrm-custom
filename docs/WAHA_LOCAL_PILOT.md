# Guia do Piloto Local WhatsApp com WAHA no CICLOPES

Este documento contém o passo a passo operacional completo para executar o **Piloto Local do WhatsApp** utilizando o provedor **WAHA** no **CICLOPES**.

---

## 1. Visão Geral da Arquitetura do Piloto

```
+------------------------------------+          +------------------------------------+
|  WhatsApp no Celular Comercial     |          |  WhatsApp no Celular de Testes     |
|             (Telefone A)           |          |             (Telefone B)           |
+-----------------+------------------+          +-----------------+------------------+
                  |                                               |
                  | (Escaneia QR Code)                            | (Envia Mensagem)
                  v                                               v
+------------------------------------------------------------------------------------+
|                               Rede WhatsApp / Meta                                 |
+------------------------------------------------------------------------------------+
                                           |
                                           v
                       +---------------------------------------+
                       |              WAHA Service             |
                       |       (Docker container na porta 3001)|
                       |   Volume persistente: ./waha-sessions |
                       +-------------------+-------------------+
                                           |
                                           | Webhook com HMAC / Polling
                                           v
                       +---------------------------------------+
                       |          CICLOPES Application         |
                       |        (Next.js na porta 3000)        |
                       |   - Ingestão unificada                |
                       |   - Fila durável PGMQ                 |
                       |   - Reconciliação com overlap 10m     |
                       |   - Zero IA automática (On-Demand)    |
                       +-------------------+-------------------+
                                           |
                                           v
                       +---------------------------------------+
                       |          PostgreSQL Database          |
                       |     (contacts, conversations, msgs)   |
                       +---------------------------------------+
```

---

## 2. Pré-requisitos

1. **Docker e Docker Compose** instalados e em execução.
2. **Node.js 20+** e **npm**.
3. **Dois telefones com WhatsApp ativo**:
   - **Telefone A:** Número comercial da empresa que será conectado ao CRM.
   - **Telefone B:** Número independente de teste para simular o cliente.

---

## 3. Comandos de Gerenciamento do WAHA

### Iniciar o container do WAHA:
```bash
docker compose -f docker-compose.waha.yml up -d
```

### Inspecionar logs seguros do WAHA:
```bash
docker logs -f wacrm-waha
```

### Verificar status da porta e do container:
```bash
docker ps --filter "name=wacrm-waha"
```

### Reiniciar o container do WAHA (sem perder a sessão vinculada):
```bash
docker compose -f docker-compose.waha.yml restart
```

### Parar o container do WAHA:
```bash
docker compose -f docker-compose.waha.yml down
```

---

## 4. Inicialização do CICLOPES

1. Inicie a aplicação Next.js:
```bash
npm run dev
```
2. Acesse no navegador:
```
http://localhost:3000/settings?tab=whatsapp
```

---

## 5. Roteiro de Teste do Piloto (Runbook de 2 Telefones)

### Teste 1: Conexão via QR Code (Telefone A)
1. Acesse **Configurações &gt; WhatsApp**.
2. Certifique-se de que a aba **WAHA (QR Code)** está selecionada.
3. Clique em **Conectar WhatsApp**.
4. O QR Code dinâmico será exibido na tela.
5. No **Telefone A** (WhatsApp comercial):
   - Vá em **Configurações &gt; Aparelhos conectados &gt; Conectar aparelho**.
   - Aponte a câmera para o QR Code no CICLOPES.
6. A interface mudará automaticamente para o estado **Conectado**, exibindo o número de telefone e o selo **Em dia**.
7. **Verificação de Segurança:** Nenhuma mensagem é enviada a nenhum contato ao parear.

### Teste 2: Ingestão de Mensagem de Entrada (Telefone B)
1. Do **Telefone B**, envie uma mensagem para o número do **Telefone A**:
   > *"Olá! Gostaria de informações sobre os serviços disponíveis."*
2. No CICLOPES, abra a tela de **Inbox** (`/inbox`).
3. **Resultado Esperado:**
   - Um novo contato é criado automaticamente com o telefone do Telefone B.
   - A conversa aparece na lista de conversas com a mensagem recebida em tempo real.
   - **Verificação Econômica:** 0 chamadas de LLM / IA são disparadas (modo On-Demand padrão).

### Teste 3: Resposta Humana pelo CICLOPES
1. No Inbox do CICLOPES, selecione a conversa do Telefone B.
2. Digite uma resposta humana e clique em **Enviar**:
   > *"Olá! Como posso ajudar você hoje?"*
3. **Resultado Esperado:**
   - A mensagem é entregue no Telefone B.
   - No histórico do CICLOPES, a mensagem aparece como enviada por `agent`.

### Teste 4: Resposta Enviada pelo Celular Físico (Telefone A)
1. No aplicativo WhatsApp do **Telefone A**, abra a conversa com o Telefone B e responda diretamente pelo celular:
   > *"Respondendo diretamente pelo celular físico."*
2. **Resultado Esperado:**
   - O CICLOPES ingere a mensagem com `fromMe: true`, registrando-a como `agent` no histórico.
   - A ordem cronológica é mantida perfeitamente e o contador de não lidas para o atendente não é incrementado.

### Teste 5: Resiliência contra Queda Temporária do CICLOPES
1. Pare temporariamente o servidor do CICLOPES (`Ctrl+C` no terminal do `npm run dev`). Mantenha o WAHA rodando.
2. Envie 2 mensagens do **Telefone B** para o **Telefone A**.
3. Inicie novamente o CICLOPES (`npm run dev`).
4. Clique em **Sincronizar agora** em Configurações &gt; WhatsApp (ou aguarde a reconciliação automática).
5. **Resultado Esperado:** Todas as mensagens enviadas durante a indisponibilidade são recuperadas e inseridas no histórico na ordem correta, sem duplicatas.

### Teste 6: Resiliência contra Reinício do WAHA / Máquina
1. Com a sessão conectada, reinicie o container do WAHA:
   ```bash
   docker compose -f docker-compose.waha.yml restart
   ```
2. Aguarde 10 segundos.
3. No CICLOPES, verifique o status da sessão em Configurações &gt; WhatsApp.
4. **Resultado Esperado:** A sessão retorna automaticamente para `WORKING` **sem necessidade de escanear novo QR Code**, graças ao volume persistente `./waha-sessions`.

---

## 6. O que sobrevive e o que requer novo QR

| Cenário | Requer Novo QR Code? | Comportamento |
| :--- | :---: | :--- |
| **Reinício do Ciclopes (Node.js)** | **NÃO** | Sessão no WAHA permanece ativa. |
| **Reinício do Container WAHA** | **NÃO** | As credenciais são restauradas do disco (`./waha-sessions`). |
| **Reinício do Computador / VPS** | **NÃO** | Docker restaura o volume persistente e reconecta ao WhatsApp. |
| **Usuário desconecta pelo WhatsApp** | **SIM** | WhatsApp encerra a chave criptográfica do pareamento. |
| **Usuário clica em "Desconectar" no CRM** | **SIM** | O CRM instrui o WAHA a desvincular o aparelho. |
