'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  QrCode,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Server,
  Cloud,
  Clock,
  ShieldCheck,
  Radio,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ActiveProvider = 'waha' | 'meta';
type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

interface WahaSessionState {
  provider: 'waha';
  connected: boolean;
  session?: {
    name: string;
    status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | string;
    me?: { id?: string; pushName?: string } | null;
  };
  error?: string;
}

interface WahaSyncState {
  last_sync_status: 'idle' | 'syncing' | 'success' | 'partial' | 'failed' | 'error';
  last_sync_completed_at?: string | null;
  last_sync_error?: string | null;
  sync_stats?: {
    messagesDiscovered?: number;
    messagesInserted?: number;
    duplicatesIgnored?: number;
    durationMs?: number;
    chatsScanned?: number;
    chatsSucceeded?: number;
    chatsFailed?: number;
    errorsCount?: number;
  } | null;
}

function formatPhoneDisplay(rawId?: string | null): string {
  if (!rawId) return '';
  const digits = rawId.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits ? `+${digits}` : rawId;
}

export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ActiveProvider>('waha');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const loadedAccountIdRef = useRef<string | null>(null);

  // Meta Form States
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // WAHA Form States
  const [wahaBaseUrl, setWahaBaseUrl] = useState('http://localhost:3001');
  const [wahaApiKey, setWahaApiKey] = useState('wacrm-local-dev-key');
  const [wahaSessionName, setWahaSessionName] = useState('wacrm');
  const [wahaInitialSyncHours, setWahaInitialSyncHours] = useState<number>(0);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const wahaWebhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/waha/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', acctId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load config row:', error);
      }

      if (data) {
        setConfig(data);
        const prov = (data.provider as ActiveProvider) || 'waha';
        setSelectedProvider(prov);

        if (prov === 'waha') {
          setWahaBaseUrl(data.waha_base_url || 'http://localhost:3001');
          setWahaSessionName(data.waha_session_name || 'wacrm');
          setWahaApiKey(MASKED_TOKEN);
        } else {
          setPhoneNumberId(data.phone_number_id || '');
          setWabaId(data.waba_id || '');
          setAccessToken(MASKED_TOKEN);
          setVerifyToken('');
          setPin('');
          setTokenEdited(false);
        }
      } else {
        setConfig(null);
        setSelectedProvider('waha');
        setWahaBaseUrl('http://localhost:3001');
        setWahaSessionName(`ciclopes_${acctId.replace(/-/g, '').slice(0, 8)}`);
        setWahaApiKey('wacrm-local-dev-key');
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      }

      // Verify health via the API
      if (data) {
        try {
          const res = await fetch('/api/whatsapp/config', { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(
              payload.needs_reset
                ? 'token_corrupted'
                : payload.reason === 'meta_api_error'
                  ? 'meta_api_error'
                  : null
            );
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load WhatsApp configuration');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSaveMeta() {
    if (!phoneNumberId.trim()) {
      toast.error('Phone Number ID is required');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for initial setup');
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        provider: 'meta',
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        pin: pin.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        toast.error('Please re-enter the Access Token to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        return;
      }

      toast.success(
        data.phone_info?.verified_name
          ? `Live — ${data.phone_info.verified_name} can now receive events.`
          : 'WhatsApp connected.'
      );
      setPin('');
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveWaha() {
    if (!wahaBaseUrl.trim() || !wahaSessionName.trim()) {
      toast.error('WAHA URL and session name are required');
      return;
    }
    if (!config && (!wahaApiKey.trim() || wahaApiKey === MASKED_TOKEN)) {
      toast.error('WAHA API Key is required for initial setup');
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        provider: 'waha',
        waha_base_url: wahaBaseUrl.trim(),
        waha_session_name: wahaSessionName.trim(),
        waha_api_key: wahaApiKey === MASKED_TOKEN ? undefined : wahaApiKey.trim(),
      };

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save WAHA configuration');
        return;
      }

      toast.success('Configuração do WAHA salva com sucesso.');
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('WAHA Save error:', err);
      toast.error('Erro ao salvar configuração do WAHA');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestMetaConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Connected to ${payload.phone_info.verified_name}`
            : 'API connection successful'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset
            ? 'token_corrupted'
            : payload.reason === 'meta_api_error'
              ? 'meta_api_error'
              : null
        );
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm('Deseja resetar a configuração do WhatsApp? Você precisará reconfigurar as credenciais.')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Erro ao resetar');
        return;
      }

      toast.success('Configuração limpa com sucesso.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setPin('');
      setWahaApiKey('wacrm-local-dev-key');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Erro ao resetar configuração');
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Provider Selector */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">{t('providerSelectorTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('providerSelectorDesc')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* WAHA Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSelectedProvider('waha')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelectedProvider('waha');
            }}
            className={`cursor-pointer rounded-lg border p-4 transition-all ${
              selectedProvider === 'waha'
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border bg-background hover:bg-muted/40'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <QrCode className="size-4" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-foreground">{t('providerWahaTitle')}</h4>
                  <Badge variant="secondary" className="mt-0.5 text-[10px] font-normal bg-primary/10 text-primary border-primary/20">
                    {t('providerWahaBadge')}
                  </Badge>
                </div>
              </div>
              <div
                className={`size-4 rounded-full border flex items-center justify-center ${
                  selectedProvider === 'waha' ? 'border-primary bg-primary' : 'border-muted-foreground'
                }`}
              >
                {selectedProvider === 'waha' && <div className="size-1.5 rounded-full bg-primary-foreground" />}
              </div>
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground leading-relaxed">
              {t('providerWahaDesc')}
            </p>
          </div>

          {/* Meta Cloud API Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSelectedProvider('meta')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelectedProvider('meta');
            }}
            className={`cursor-pointer rounded-lg border p-4 transition-all ${
              selectedProvider === 'meta'
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border bg-background hover:bg-muted/40'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Cloud className="size-4" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-foreground">{t('providerMetaTitle')}</h4>
                  <Badge variant="outline" className="mt-0.5 text-[10px] font-normal text-muted-foreground border-border">
                    {t('providerMetaBadge')}
                  </Badge>
                </div>
              </div>
              <div
                className={`size-4 rounded-full border flex items-center justify-center ${
                  selectedProvider === 'meta' ? 'border-primary bg-primary' : 'border-muted-foreground'
                }`}
              >
                {selectedProvider === 'meta' && <div className="size-1.5 rounded-full bg-primary-foreground" />}
              </div>
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground leading-relaxed">
              {t('providerMetaDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* Render Active Provider Panel */}
      {selectedProvider === 'waha' ? (
        <WahaExperiencePanel
          config={config}
          baseUrl={wahaBaseUrl}
          setBaseUrl={setWahaBaseUrl}
          apiKey={wahaApiKey}
          setApiKey={setWahaApiKey}
          sessionName={wahaSessionName}
          setSessionName={setWahaSessionName}
          initialSyncHours={wahaInitialSyncHours}
          setInitialSyncHours={setWahaInitialSyncHours}
          onSave={handleSaveWaha}
          saving={saving}
          onReset={handleReset}
          resetting={resetting}
          onReload={async () => {
            if (accountId) await fetchConfig(accountId);
          }}
          wahaWebhookUrl={wahaWebhookUrl}
        />
      ) : (
        /* Meta Cloud API Panel */
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {resetReason === 'token_corrupted' && (
              <Alert className="bg-amber-950/40 border-amber-600/40">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <AlertTitle className="text-amber-200 mb-1">{t('tokenCorrupted')}</AlertTitle>
                    <AlertDescription className="text-amber-100/80 text-sm">{statusMessage}</AlertDescription>
                    <Button
                      onClick={handleReset}
                      disabled={resetting}
                      size="sm"
                      className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                      {t('resetConfig')}
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-foreground">{t('apiCredentialsTitle')}</CardTitle>
                  <Badge variant={connectionStatus === 'connected' ? 'default' : 'secondary'}>
                    {connectionStatus === 'connected' ? t('credentialsValid') : t('notConnected')}
                  </Badge>
                </div>
                <CardDescription>{t('apiCredentialsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('phoneNumberId')}</Label>
                  <Input
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    placeholder="100609346426084"
                    className="bg-muted border-border text-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('wabaId')}</Label>
                  <Input
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    placeholder="107764358872543"
                    className="bg-muted border-border text-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('accessToken')}</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={accessToken}
                      onChange={(e) => {
                        setAccessToken(e.target.value);
                        setTokenEdited(true);
                      }}
                      placeholder={t('accessTokenPlaceholder')}
                      className="bg-muted border-border text-foreground pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {config && !tokenEdited && (
                    <p className="text-xs text-muted-foreground">{t('tokenHidden')}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('webhookVerifyToken')}</Label>
                  <Input
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    placeholder={t('webhookVerifyTokenPlaceholder')}
                    className="bg-muted border-border text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">{t('webhookVerifyTokenHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t('twoStepPin')} <span className="ml-1 text-muted-foreground">{t('optional')}</span>
                  </Label>
                  <Input
                    type="password"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('pinPlaceholder')}
                    className="bg-muted border-border text-foreground tracking-widest"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('pinHint')}</p>
                </div>

                <div className="pt-2 flex flex-wrap gap-3">
                  <Button onClick={handleSaveMeta} disabled={saving}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                    {t('saveConfig')}
                  </Button>
                  <Button variant="outline" onClick={handleTestMetaConnection} disabled={testing || !config}>
                    {testing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    {t('testConnection')}
                  </Button>
                  {config && (
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      disabled={resetting}
                      className="border-red-900 text-red-400 hover:bg-red-950/40"
                    >
                      {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                      {t('resetConfig')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Meta Webhook Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
                <CardDescription>{t('webhookDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('webhookUrl')}</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={webhookUrl} className="bg-muted border-border text-foreground font-mono text-xs" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        toast.success('Webhook URL copiada!');
                      }}
                      className="border-border hover:bg-muted shrink-0"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Meta Setup Guide Rail */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground text-base">{t('setupInstructions')}</CardTitle>
                <CardDescription>{t('setupInstructionsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Accordion className="w-full">
                  <AccordionItem value="step-1" className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                        {t('step1')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-decimal list-inside space-y-1 text-sm">
                        <li>{t('step1_1')}</li>
                        <li>{t('step1_2')}</li>
                        <li>{t('step1_3')}</li>
                        <li>{t('step1_4')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="step-2" className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                        {t('step2')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-decimal list-inside space-y-1 text-sm">
                        <li>{t('step2_1')}</li>
                        <li>{t('step2_2')}</li>
                        <li>{t('step2_3')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="step-3" className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                        {t('step3')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-decimal list-inside space-y-1 text-sm">
                        <li>{t('step3_1')}</li>
                        <li>
                          {t.rich('step3_2', {
                            strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                          })}
                        </li>
                        <li>
                          {t.rich('step3_3', {
                            strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                          })}
                        </li>
                        <li>
                          {t.rich('step3_4', {
                            strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                          })}
                        </li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="step-4" className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                        {t('step4')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-decimal list-inside space-y-1 text-sm">
                        <li>{t('step4_1')}</li>
                        <li>{t('step4_2')}</li>
                        <li>
                          {t.rich('step4_3', {
                            strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                          })}
                        </li>
                        <li>
                          {t.rich('step4_4', {
                            strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                          })}
                        </li>
                        <li>{t('step4_5')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="mt-4 pt-4 border-t border-border">
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    {t('metaDocs')}
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * WAHA Experience Panel:
 * Native QR code flow, real session lifecycle, auto-reconciliation,
 * connection health metrics, and non-destructive reconnection.
 */
function WahaExperiencePanel({
  config,
  baseUrl,
  setBaseUrl,
  apiKey,
  setApiKey,
  sessionName,
  setSessionName,
  initialSyncHours,
  setInitialSyncHours,
  onSave,
  saving,
  onReset,
  resetting,
  onReload,
  wahaWebhookUrl,
}: {
  config: WhatsAppConfigType | null;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  sessionName: string;
  setSessionName: (v: string) => void;
  initialSyncHours: number;
  setInitialSyncHours: (v: number) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  onReset: () => void;
  resetting: boolean;
  onReload: () => Promise<void>;
  wahaWebhookUrl: string;
}) {
  const t = useTranslations('Settings.whatsapp');
  const [sessionState, setSessionState] = useState<WahaSessionState | null>(null);
  const [syncState, setSyncState] = useState<WahaSyncState | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [starting, setStarting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [qrVersion, setQrVersion] = useState(0);
  const [qrError, setQrError] = useState<string | null>(null);

  const rawStatus = sessionState?.session?.status ?? (config ? 'STARTING' : 'NOT_CONFIGURED');
  const isWorking = sessionState?.connected || rawStatus === 'WORKING';
  const isScanning = rawStatus === 'SCAN_QR_CODE' || (!isWorking && config !== null);

  const connectedNumber = formatPhoneDisplay(sessionState?.session?.me?.id);
  const pushName = sessionState?.session?.me?.pushName;

  const loadStatus = useCallback(async () => {
    try {
      const [sessRes, syncRes] = await Promise.all([
        fetch('/api/whatsapp/waha/session', { cache: 'no-store' }),
        fetch('/api/whatsapp/waha/sync', { cache: 'no-store' }),
      ]);

      if (sessRes.ok) {
        const sessData = (await sessRes.json()) as WahaSessionState;
        setSessionState(sessData);
        if (sessData.connected || sessData.session?.status === 'WORKING') {
          setQrError(null);
        }
      }

      if (syncRes.ok) {
        const syncData = await syncRes.json();
        setSyncState(syncData.sync_state || null);
      }
    } catch (err) {
      console.error('[waha-panel] status fetch failed:', err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  async function handleStartOrEnsure() {
    setStarting(true);
    setQrError(null);
    try {
      if (!config) {
        await onSave();
      }
      const res = await fetch('/api/whatsapp/waha/session', { method: 'POST' });
      const data = (await res.json()) as WahaSessionState;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSessionState(data);
      setQrVersion((v) => v + 1);
      toast.success(
        data.connected
          ? 'WhatsApp conectado.'
          : 'Sessão iniciada. Escaneie o QR Code abaixo com o celular.'
      );
      await onReload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao iniciar sessão';
      toast.error(message);
    } finally {
      setStarting(false);
      void loadStatus();
    }
  }

  async function handleRestartConnection() {
    setReconnecting(true);
    try {
      const res = await fetch('/api/whatsapp/waha/session', { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Conexão reiniciada com sucesso.');
      await onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao reiniciar conexão');
    } finally {
      setReconnecting(false);
      void loadStatus();
    }
  }

  async function handleLogoutDevice() {
    if (!confirm(t('wahaDisconnectConfirm'))) return;

    setLoggingOut(true);
    try {
      const res = await fetch('/api/whatsapp/waha/session', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Aparelho desconectado. A sessão foi desvinculada.');
      setSessionState(null);
      setQrVersion((v) => v + 1);
      await onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao desconectar');
    } finally {
      setLoggingOut(false);
      void loadStatus();
    }
  }

  async function handleManualSync() {
    setSyncingNow(true);
    try {
      const res = await fetch('/api/whatsapp/waha/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialSyncWindowHours: initialSyncHours }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (data.status === 'success' || (data.success && (!data.stats || data.stats.chatsFailed === 0))) {
        toast.success(
          `Sincronização concluída: ${data.stats?.messagesInserted ?? 0} nova(s) mensagem(ns), ${data.stats?.duplicatesIgnored ?? 0} existente(s).`
        );
      } else if (data.status === 'partial') {
        toast.warning(
          `Sincronização parcial: ${data.stats?.messagesInserted ?? 0} nova(s), ${data.stats?.chatsFailed ?? 0} conversa(s) falharam.`
        );
      } else {
        toast.error(data.error || data.reason || 'Falha ao sincronizar histórico do WhatsApp.');
      }
      void loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha na sincronização');
    } finally {
      setSyncingNow(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {/* Main Status Header Card */}
        <Card
          className={`border transition-all ${
            isWorking
              ? 'border-emerald-700/40 bg-emerald-950/10'
              : isScanning
                ? 'border-primary/40 bg-primary/5'
                : 'border-border bg-card'
          }`}
        >
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex size-10 items-center justify-center rounded-xl ${
                    isWorking
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : isScanning
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isWorking ? (
                    <CheckCircle2 className="size-5" />
                  ) : isScanning ? (
                    <QrCode className="size-5 animate-pulse" />
                  ) : (
                    <Smartphone className="size-5" />
                  )}
                </div>
                <div>
                  <CardTitle className="text-base text-foreground">
                    {isWorking
                      ? t('wahaConnected')
                      : isScanning
                        ? t('wahaWaitingQr')
                        : t('wahaDisconnected')}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {isWorking
                      ? t('wahaConnectedDesc')
                      : isScanning
                        ? t('wahaWaitingQrDesc')
                        : t('wahaDisconnectedDesc')}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant={isWorking ? 'default' : 'secondary'}
                  className={
                    isWorking
                      ? 'bg-emerald-600/20 text-emerald-300 border-emerald-600/30'
                      : isScanning
                        ? 'bg-primary/20 text-primary border-primary/30'
                        : 'bg-muted text-muted-foreground border-border'
                  }
                >
                  <span
                    className={`mr-1.5 size-1.5 rounded-full ${
                      isWorking ? 'bg-emerald-400' : isScanning ? 'bg-primary animate-ping' : 'bg-muted-foreground'
                    }`}
                  />
                  {rawStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-2">
            {/* Connected State Card View */}
            {isWorking ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                    <p className="text-xs text-muted-foreground">{t('wahaConnectedNumber')}</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {connectedNumber || 'Número não informado'}
                    </p>
                    {pushName && <p className="text-xs text-muted-foreground/80 mt-0.5">{pushName}</p>}
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                    <p className="text-xs text-muted-foreground">{t('wahaLastSync')}</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {syncState?.last_sync_completed_at
                        ? new Date(syncState.last_sync_completed_at).toLocaleTimeString()
                        : 'Recente'}
                    </p>
                    {syncState?.last_sync_status === 'failed' || syncState?.last_sync_status === 'error' ? (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="size-3.5" />
                        <span>Falha na sincronização</span>
                      </div>
                    ) : syncState?.last_sync_status === 'partial' ? (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-400">
                        <AlertCircle className="size-3.5" />
                        <span>Sincronização parcial</span>
                      </div>
                    ) : (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-400">
                        <ShieldCheck className="size-3.5" />
                        <span>{t('wahaSyncHealthy')}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-2">
                  <Button onClick={handleManualSync} disabled={syncingNow} size="sm">
                    {syncingNow ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    {t('wahaSyncNow')}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleRestartConnection}
                    disabled={reconnecting}
                    size="sm"
                    className="border-border"
                  >
                    {reconnecting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    {t('wahaRestartSession')}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleLogoutDevice}
                    disabled={loggingOut}
                    size="sm"
                    className="border-red-900/60 text-red-400 hover:bg-red-950/40 hover:text-red-300 ml-auto"
                  >
                    {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                    {t('wahaDisconnect')}
                  </Button>
                </div>
              </div>
            ) : (
              /* QR Code Scan Flow */
              <div className="grid gap-5 md:grid-cols-[280px_1fr] pt-2">
                <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 p-4 relative">
                  {rawStatus === 'STARTING' || starting ? (
                    <div className="flex flex-col items-center justify-center p-6 text-center">
                      <Loader2 className="size-8 animate-spin text-primary mb-3" />
                      <p className="text-sm font-medium text-foreground">{t('wahaStarting')}</p>
                      <p className="text-xs text-muted-foreground mt-1">Aguarde a inicialização do motor WhatsApp...</p>
                    </div>
                  ) : qrError ? (
                    <div className="text-center p-4">
                      <AlertTriangle className="mx-auto size-10 text-amber-400" />
                      <p className="mt-2 text-sm font-medium text-foreground">{t('wahaQrExpired')}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setQrError(null);
                          setQrVersion((v) => v + 1);
                          void loadStatus();
                        }}
                        className="mt-3"
                      >
                        <RefreshCw className="size-3.5 mr-1" />
                        {t('wahaQrRefresh')}
                      </Button>
                    </div>
                  ) : rawStatus === 'SCAN_QR_CODE' || config !== null ? (
                    <div className="text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={qrVersion}
                        src={`/api/whatsapp/waha/qr?v=${qrVersion}`}
                        alt="QR Code para conectar WhatsApp"
                        className="h-60 w-60 rounded-xl bg-white object-contain p-2 shadow-sm border"
                        onError={() =>
                          setQrError('Sessão iniciando ou QR Code indisponível. Clique para recarregar.')
                        }
                      />
                      <p className="mt-2 text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                        <Radio className="size-3 text-emerald-400 animate-pulse" />
                        Atualização em tempo real
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-6 text-center">
                      <QrCode className="size-10 text-muted-foreground mb-2 opacity-50" />
                      <p className="text-xs text-muted-foreground">Clique em Conectar WhatsApp para gerar o QR Code.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="text-sm font-semibold text-foreground">Passo a passo</h4>
                    <ol className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed">
                      <li className="flex gap-2">
                        <span className="font-semibold text-primary">1.</span> Abra o WhatsApp no celular comercial da sua empresa.
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-primary">2.</span> Vá em <strong>Configurações &gt; Aparelhos conectados</strong>.
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-primary">3.</span> Toque em <strong>Conectar aparelho</strong>.
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-primary">4.</span> Aponte a câmera para o QR Code ao lado.
                      </li>
                    </ol>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleStartOrEnsure} disabled={starting}>
                      {starting ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                      {t('wahaStartSession')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQrError(null);
                        setQrVersion((v) => v + 1);
                        void loadStatus();
                      }}
                    >
                      <RefreshCw className="size-4" />
                      {t('wahaQrRefresh')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Initial Sync Policy Window Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              {t('wahaInitialSyncTitle')}
            </CardTitle>
            <CardDescription className="text-xs">{t('wahaInitialSyncDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { hours: 0, label: t('wahaSyncNowOnly'), desc: 'Mais rápido e seguro para o piloto' },
                { hours: 24, label: t('wahaSync24h'), desc: 'Recupera mensagens do último dia' },
                { hours: 168, label: t('wahaSync7d'), desc: 'Histórico da última semana' },
                { hours: 720, label: t('wahaSync30d'), desc: 'Histórico dos últimos 30 dias' },
              ].map((opt) => (
                <div
                  key={opt.hours}
                  role="button"
                  tabIndex={0}
                  onClick={() => setInitialSyncHours(opt.hours)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setInitialSyncHours(opt.hours);
                  }}
                  className={`cursor-pointer rounded-lg border p-3 transition-all ${
                    initialSyncHours === opt.hours
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-background hover:bg-muted/40'
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Advanced WAHA Configuration Accordion */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              <Server className="size-4 text-primary" />
              {t('wahaAdvancedTitle')}
            </CardTitle>
            <CardDescription className="text-xs">{t('wahaAdvancedDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion className="w-full">
              <AccordionItem value="waha-adv" className="border-border">
                <AccordionTrigger className="text-xs text-muted-foreground hover:text-foreground">
                  Configurações de rede e credenciais locais
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{t('wahaBaseUrl')}</Label>
                      <Input
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="http://localhost:3001"
                        className="bg-muted border-border text-foreground text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{t('wahaSessionName')}</Label>
                      <Input
                        value={sessionName}
                        onChange={(e) => setSessionName(e.target.value)}
                        placeholder="wacrm"
                        className="bg-muted border-border text-foreground text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{t('wahaApiKey')}</Label>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="wacrm-local-dev-key"
                      className="bg-muted border-border text-foreground text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{t('wahaWebhookUrl')}</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={wahaWebhookUrl}
                        className="bg-muted border-border text-foreground font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(wahaWebhookUrl);
                          toast.success('Webhook URL copiada!');
                        }}
                        className="border-border hover:bg-muted shrink-0"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap gap-2">
                    <Button onClick={onSave} disabled={saving} size="sm">
                      {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                      Salvar parâmetros
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onReset}
                      disabled={resetting}
                      size="sm"
                      className="border-red-900/60 text-red-400 hover:bg-red-950/40"
                    >
                      {resetting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                      Resetar
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>

      {/* Right Sidebar: Quick Checklist & Architecture info */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-foreground">Piloto WhatsApp</CardTitle>
            <CardDescription className="text-xs">Informações de operação do WAHA.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                <strong>Sessão Persistente:</strong> Reiniciar o Ciclopes ou o Docker não perde a conexão vinculada.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                <strong>Zero IA Automática:</strong> Mensagens de entrada não disparam LLM (modo On-Demand padrão).
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                <strong>Idempotência:</strong> Reconciliação e webhooks repetidos nunca duplicam conversas ou mensagens.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-foreground">Status do Serviço</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Motor:</span>
              <span className="font-medium text-foreground">WAHA Core (WEBJS)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Porta Local:</span>
              <span className="font-mono text-foreground">3001</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sessão:</span>
              <span className="font-mono text-foreground">{sessionName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status da Sessão:</span>
              <span className={isWorking ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                {loadingStatus ? 'Verificando...' : rawStatus}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
