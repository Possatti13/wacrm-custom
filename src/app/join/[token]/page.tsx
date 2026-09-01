'use client';

// ============================================================
// /join/[token] — invitation redemption landing page.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

const ROLE_LABEL: Record<PeekOk['role'], string> = {
  admin: 'Administrador',
  agent: 'Operador Comercial',
  viewer: 'Visualizador',
};

const FAIL_COPY: Record<PeekFail['reason'], { title: string; body: string }> = {
  not_found: {
    title: 'Convite não encontrado',
    body: 'Este link não corresponde a um convite válido. Verifique a URL ou solicite um novo convite ao administrador da organização.',
  },
  used: {
    title: 'Convite já utilizado',
    body: 'Este convite já foi aceito anteriormente. Se não foi você, peça ao administrador da organização para emitir um novo link.',
  },
  expired: {
    title: 'Convite expirado',
    body: 'Este convite atingiu o tempo limite de validade. Peça ao administrador para emitir um novo convite.',
  },
  server_error: {
    title: 'Erro ao verificar convite',
    body: 'Não foi possível validar este convite no momento. Tente recarregar a página em instantes.',
  },
};

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(
    undefined,
  );
  const [accepting, setAccepting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    setPeek(null);
    setAuthedUserId(undefined);
    try {
      const [peekRes, authRes] = await Promise.all([
        fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
          cache: 'no-store',
        }),
        createClient().auth.getUser(),
      ]);
      const peekBody = (await peekRes.json()) as PeekResult;
      setPeek(peekBody);
      setAuthedUserId(authRes.data.user?.id ?? null);
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [peekRes, authRes] = await Promise.all([
          fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
            cache: 'no-store',
          }),
          createClient().auth.getUser(),
        ]);
        const peekBody = (await peekRes.json()) as PeekResult;
        if (cancelled) return;
        setPeek(peekBody);
        setAuthedUserId(authRes.data.user?.id ?? null);
      } catch (err) {
        console.error('[join] peek error:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (res.status === 409) {
          setConflictMessage(
            payload.error ||
              'Você já pertence a outro workspace. Entre com outro e-mail para ingressar nesta organização.',
          );
        } else {
          toast.error(payload.error || 'Falha ao aceitar o convite');
        }
        setAccepting(false);
        return;
      }
      toast.success('Bem-vindo à equipe!');
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] redeem error:', err);
      toast.error('Erro de conexão ao aceitar convite');
      setAccepting(false);
    }
  }, [token]);

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      window.location.reload();
    } catch (err) {
      console.error('[join] sign-out error:', err);
      toast.error('Não foi possível desconectar. Tente recarregar a página.');
      setSigningOut(false);
    }
  }, []);

  // ----- Loading state -----
  if (peek === null || authedUserId === undefined) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-[#1E3A5F] dark:text-primary" />
          <p className="text-xs text-muted-foreground font-medium">Verificando convite...</p>
        </CardContent>
      </Card>
    );
  }

  // ----- Peek failed -----
  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-500" />
          </div>
          <CardTitle className="text-xl font-bold font-sans text-foreground">{copy.title}</CardTitle>
          <CardDescription className="text-xs text-muted-foreground leading-relaxed">
            {copy.body}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {peek.reason === 'server_error' ? (
            <>
              <Button
                onClick={loadPeekAndAuth}
                className="w-full bg-[#1E3A5F] text-[#F7F3EC] hover:bg-[#162B46] dark:bg-primary dark:text-primary-foreground font-semibold"
              >
                Tentar novamente
              </Button>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="w-full border-border text-xs font-semibold"
                >
                  Voltar para o Login
                </Button>
              </Link>
            </>
          ) : (
            <Link href="/login">
              <Button
                className="w-full bg-[#1E3A5F] text-[#F7F3EC] hover:bg-[#162B46] dark:bg-primary dark:text-primary-foreground font-semibold"
              >
                Voltar para o Login
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----- Peek OK -----
  const inviteHeader = (
    <CardHeader className="items-center text-center pb-4">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-[#1E3A5F]/10 dark:bg-primary/10 text-[#1E3A5F] dark:text-primary">
        <UsersRound className="h-6 w-6" />
      </div>
      <CardTitle className="text-xl font-bold font-sans text-foreground">
        Você foi convidado para{' '}
        <span className="text-[#1E3A5F] dark:text-primary">{peek.account_name}</span>
      </CardTitle>
      <CardDescription className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
        <ShieldCheck className="size-3.5 text-primary" />
        <span>
          Função: {ROLE_LABEL[peek.role]} • Válido até{' '}
          {new Date(peek.expires_at).toLocaleDateString('pt-BR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </CardDescription>
    </CardHeader>
  );

  // ----- Authed: show Accept button -----
  if (authedUserId) {
    return (
      <>
        <Card className="w-full max-w-md border-border bg-card shadow-lg">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-semibold py-2.5 shadow-sm transition-all"
            >
              {accepting ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-1.5" />
                  Aceitando convite...
                </>
              ) : (
                <>
                  <CheckCircle className="size-4 mr-1.5" />
                  Aceitar Convite
                </>
              )}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Ao aceitar, sua conta terá acesso operacional a{' '}
              <span className="font-semibold text-foreground">{peek.account_name}</span>.
            </p>
          </CardContent>
        </Card>

        <Dialog
          open={conflictMessage !== null}
          onOpenChange={(open) => {
            if (!open) setConflictMessage(null);
          }}
        >
          <DialogContent className="bg-card border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground font-sans">
                <AlertTriangle className="size-4 text-amber-500" />
                Não é possível ingressar com esta conta
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {conflictMessage}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2 text-xs text-muted-foreground">
              <p>
                Para entrar em{' '}
                <span className="font-semibold text-foreground">{peek.account_name}</span>,
                desconecte-se da sua conta atual e crie uma nova conta com outro e-mail através deste convite.
              </p>
            </div>
            <DialogFooter className="border-border">
              <Button
                variant="outline"
                onClick={() => setConflictMessage(null)}
                className="border-border text-xs"
              >
                Permanecer conectado
              </Button>
              <Button
                onClick={handleSignOutAndRetry}
                disabled={signingOut}
                className="bg-[#1E3A5F] text-[#F7F3EC] hover:bg-[#162B46] dark:bg-primary dark:text-primary-foreground text-xs font-semibold"
              >
                {signingOut ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-1" />
                    Desconectando...
                  </>
                ) : (
                  'Sair e usar outro e-mail'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ----- Not authed: prompt to sign up or sign in -----
  return (
    <Card className="w-full max-w-md border-border bg-card shadow-lg">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2.5">
        <Link href={`/signup?invite=${encodeURIComponent(token!)}`} className="w-full">
          <Button className="w-full bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-semibold py-2.5">
            Criar conta e aceitar convite
          </Button>
        </Link>
        <Link href={`/login?invite=${encodeURIComponent(token!)}`} className="w-full">
          <Button
            variant="outline"
            className="w-full border-border text-xs font-semibold"
          >
            Já possuo uma conta
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
