import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'messages' / 'en.json'
DST = ROOT / 'messages' / 'pt-BR.json'
CACHE = ROOT / 'scripts' / '.translate-cache-ptbr.json'

cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}

PROTECTED_WORDS = {
    'WhatsApp': '__BRAND_WHATSAPP__',
    'Meta': '__BRAND_META__',
    'wacrm': '__BRAND_WACRM__',
    'WAHA': '__BRAND_WAHA__',
    'Supabase': '__BRAND_SUPABASE__',
    'OpenAI': '__BRAND_OPENAI__',
    'Anthropic': '__BRAND_ANTHROPIC__',
    'AI': '__BRAND_AI__',
    'CSV': '__BRAND_CSV__',
    'API': '__BRAND_API__',
    'URL': '__BRAND_URL__',
    'UUID': '__BRAND_UUID__',
}

MANUAL = {
    'CRM Template for WhatsApp': 'CRM para WhatsApp',
    'Dashboard': 'Dashboard',
    'Inbox': 'Caixa de entrada',
    'Notifications': 'Notificações',
    'Contacts': 'Contatos',
    'Pipelines': 'Pipelines',
    'Broadcasts': 'Disparos',
    'Automations': 'Automações',
    'Flows': 'Fluxos',
    'AI Agents': 'Agentes de IA',
    'Settings': 'Configurações',
    'Beta': 'Beta',
    'Owner': 'Proprietário',
    'Admin': 'Admin',
    'Agent': 'Atendente',
    'Viewer': 'Visualizador',
    'User': 'Usuário',
    'Avatar': 'Avatar',
    'Profile': 'Perfil',
    'Sign out': 'Sair',
    'Email': 'E-mail',
    'Password': 'Senha',
    'Sign in': 'Entrar',
    'Create account': 'Criar conta',
    'Welcome back': 'Bem-vindo de volta',
    'Search conversations...': 'Buscar conversas...',
    'All': 'Todas',
    'Unread': 'Não lidas',
    'Open': 'Aberta',
    'Pending': 'Pendente',
    'Closed': 'Fechada',
    'Tags': 'Tags',
    'Company': 'Empresa',
    'Clear all': 'Limpar tudo',
    'No conversations found': 'Nenhuma conversa encontrada',
    'No messages yet': 'Nenhuma mensagem ainda',
    'Unknown': 'Desconhecido',
    'Today': 'Hoje',
    'Yesterday': 'Ontem',
    'Send': 'Enviar',
    'Cancel': 'Cancelar',
    'Save': 'Salvar',
    'Delete': 'Excluir',
    'Edit': 'Editar',
    'Back': 'Voltar',
    'Next': 'Próximo',
    'Loading...': 'Carregando...',
    'Saving...': 'Salvando...',
    'Creating...': 'Criando...',
    'Deleting...': 'Excluindo...',
    'Retry': 'Tentar novamente',
    'Name': 'Nome',
    'Phone': 'Telefone',
    'Created': 'Criado',
    'Status': 'Status',
    'Date': 'Data',
    'Template': 'Modelo',
    'Recipients': 'Destinatários',
    'Delivery': 'Entrega',
    'Read': 'Lido',
    'Draft': 'Rascunho',
    'Scheduled': 'Agendado',
    'Sending': 'Enviando',
    'Sent': 'Enviado',
    'Delivered': 'Entregue',
    'Replied': 'Respondido',
    'Failed': 'Falhou',
}

# Protect ICU placeholders like {count}, {count, plural, =1 {...} other {...}}
def protect_braces(s):
    out=[]; repl={}; i=0; n=len(s); k=0
    while i<n:
        if s[i]=='{':
            depth=0; j=i
            while j<n:
                if s[j]=='{': depth+=1
                elif s[j]=='}':
                    depth-=1
                    if depth==0:
                        j+=1; break
                j+=1
            token=f'__PH_{k}__'; repl[token]=s[i:j]; out.append(token); k+=1; i=j
        else:
            out.append(s[i]); i+=1
    return ''.join(out), repl

TAG_RE = re.compile(r'<[^>]+>')

def protect_regex(s, regex, prefix):
    repl={}
    def sub(m):
        token=f'__{prefix}_{len(repl)}__'
        repl[token]=m.group(0)
        return token
    return regex.sub(sub, s), repl

def protect_brands(s):
    repl={}
    # longer first
    for word, token in sorted(PROTECTED_WORDS.items(), key=lambda kv: -len(kv[0])):
        if word in s:
            s=s.replace(word, token)
            repl[token]=word
    return s, repl

def restore(s, *dicts):
    for d in dicts:
        for token, val in d.items():
            s=s.replace(token, val)
    return s

def translate_text(text):
    if text in MANUAL:
        return MANUAL[text]
    if not text or not any(c.isalpha() for c in text):
        return text
    if text in cache:
        return cache[text]

    pre=text
    pre, tag_map = protect_regex(pre, TAG_RE, 'TAG')
    pre, brace_map = protect_braces(pre)
    pre, brand_map = protect_brands(pre)

    # If after protection there are no letters, keep as-is.
    if not any(c.isalpha() for c in re.sub(r'__[A-Z0-9_]+__', '', pre)):
        translated = text
    else:
        q=urllib.parse.quote(pre)
        url=f'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q={q}'
        last_err=None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=20) as r:
                    data=json.loads(r.read().decode('utf-8'))
                translated=''.join(part[0] for part in data[0] if part[0])
                break
            except Exception as e:
                last_err=e
                time.sleep(0.7*(attempt+1))
        else:
            print('WARN translation failed:', text, last_err)
            translated=pre
        translated=restore(translated, brand_map, brace_map, tag_map)

    # Tone/term cleanup
    replacements={
        'Caixa de Entrada': 'Caixa de entrada',
        'Transmissões': 'Disparos',
        'Transmissão': 'Disparo',
        'Negócios': 'Deals',
        'Acordo': 'Deal',
        'acordo': 'deal',
        'Oleoduto': 'Pipeline',
        'oleoduto': 'pipeline',
        'Modelos de mensagem': 'Modelos de mensagens',
        'IA ': 'IA ',
        'Chave API': 'Chave de API',
        'chave API': 'chave de API',
        'Entrar em': 'Entrar',
        'Sair de': 'Sair',
    }
    for a,b in replacements.items():
        translated=translated.replace(a,b)
    cache[text]=translated
    if len(cache)%50==0:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
    return translated

def walk(obj):
    if isinstance(obj, dict):
        return {k: walk(v) for k,v in obj.items()}
    if isinstance(obj, list):
        return [walk(v) for v in obj]
    if isinstance(obj, str):
        return translate_text(obj)
    return obj

src=json.loads(SRC.read_text(encoding='utf-8'))
pt=walk(src)
DST.write_text(json.dumps(pt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'wrote {DST}')
print(f'translated/cached strings: {len(cache)}')
