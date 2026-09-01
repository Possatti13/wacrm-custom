"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CiclopesLogo } from "@/components/brand/ciclopes-logo";
import { CiclopesSymbol } from "@/components/brand/ciclopes-symbol";
import { CheckCircle, UsersRound, ShieldCheck, MailX, AlertCircle, Loader2 } from "lucide-react";

interface PeekOk {
  ok: true;
  account_name: string;
  role: "admin" | "agent" | "viewer";
  expires_at: string;
}

interface PeekFail {
  ok: false;
  reason: "not_found" | "used" | "expired" | "server_error";
}

type PeekResult = PeekOk | PeekFail;

const ROLE_LABEL: Record<PeekOk["role"], string> = {
  admin: "Administrador",
  agent: "Operador Comercial",
  viewer: "Visualizador",
};

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [peekLoading, setPeekLoading] = useState<boolean>(Boolean(inviteToken));

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!inviteToken) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(inviteToken)}/peek`, {
          cache: "no-store",
        });
        const data = (await res.json()) as PeekResult;
        if (!cancelled) {
          setPeek(data);
          setPeekLoading(false);
        }
      } catch (err) {
        console.error("[signup] peek error:", err);
        if (!cancelled) {
          setPeek({ ok: false, reason: "server_error" });
          setPeekLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!inviteToken || !peek?.ok) {
      setError("Um convite válido é obrigatório para cadastrar-se no Ciclopes.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);

    const emailRedirectTo = `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`;

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
          emailRedirectTo,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch {
      setError("Erro ao criar conta. Tente novamente.");
      setLoading(false);
    }
  };

  // State 1: Verification Email Sent
  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
        <div className="w-full max-w-md relative z-10">
          <div className="mb-8 flex flex-col items-center justify-center">
            <CiclopesLogo
              layout="stacked"
              size="lg"
              variant="aegean"
              showTagline={true}
              taglineText="Muitas conversas. Uma visão."
            />
          </div>

          <Card className="w-full border-border bg-card shadow-lg">
            <CardHeader className="items-center text-center pb-4">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl font-bold font-sans text-foreground">
                Verifique seu e-mail
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground leading-relaxed">
                Enviamos um link de confirmação para{" "}
                <span className="font-semibold text-foreground">{email}</span>.
                Clique no link para ativar sua conta e concluir a entrada na organização.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Link href="/login" className="w-full">
                <Button variant="outline" className="w-full border-border text-xs font-semibold">
                  Voltar para o Login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // State 2: No Invite Token — Protected Invite-Only Screen
  if (!inviteToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
        {/* Background Architectural Watermark */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.03] dark:opacity-[0.05]">
          <svg width="600" height="600" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" stroke="#1E3A5F" strokeWidth="0.5" strokeDasharray="2 2" />
            <circle cx="50" cy="50" r="30" stroke="#1E3A5F" strokeWidth="0.5" />
            <path d="M 12 50 C 26 26, 74 26, 88 50 C 74 74, 26 74, 12 50 Z" stroke="#1E3A5F" strokeWidth="0.75" />
            <circle cx="50" cy="50" r="12" stroke="#1E3A5F" strokeWidth="0.5" />
          </svg>
        </div>

        <div className="w-full max-w-md relative z-10">
          <div className="mb-8 flex flex-col items-center justify-center">
            <CiclopesLogo
              layout="stacked"
              size="lg"
              variant="aegean"
              showTagline={true}
              taglineText="Muitas conversas. Uma visão."
            />
          </div>

          <Card className="w-full border-border bg-card shadow-lg">
            <CardHeader className="items-center text-center pb-4">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1E3A5F]/10 dark:bg-primary/10 text-[#1E3A5F] dark:text-primary">
                <CiclopesSymbol size={34} variant="aegean" />
              </div>
              <CardTitle className="text-xl font-bold font-sans text-foreground">
                Acesso Exclusivo por Convite
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground leading-relaxed">
                O Ciclopes é uma plataforma comercial privada operando em piloto controlado. A criação de novos workspaces é restrita e novos membros ingressam exclusivamente através de convites emitidos pelos administradores de sua organização.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-xl border border-border/80 bg-muted/40 p-4 text-center">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se você recebeu um convite por e-mail, utilize o link de acesso fornecido para ativar sua conta diretamente.
                </p>
              </div>

              <Link href="/login" className="w-full">
                <Button className="w-full bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-semibold py-2.5 shadow-sm transition-all">
                  Ir para o Login
                </Button>
              </Link>
            </CardContent>
          </Card>

          <div className="mt-8 text-center text-xs text-muted-foreground/60 tracking-wider uppercase font-sans">
            Ciclopes • Sistema Operacional Comercial
          </div>
        </div>
      </div>
    );
  }

  // State 3: Validating Invite Token
  if (peekLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md text-center space-y-4">
          <Loader2 className="size-8 animate-spin mx-auto text-[#1E3A5F] dark:text-primary" />
          <p className="text-xs text-muted-foreground font-medium">Validando convite do workspace...</p>
        </div>
      </div>
    );
  }

  // State 4: Invalid or Expired Token
  if (!peek || !peek.ok) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center justify-center">
            <CiclopesLogo
              layout="stacked"
              size="lg"
              variant="aegean"
              showTagline={true}
              taglineText="Muitas conversas. Uma visão."
            />
          </div>

          <Card className="w-full border-border bg-card shadow-lg">
            <CardHeader className="items-center text-center pb-4">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                <MailX className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl font-bold font-sans text-foreground">
                Convite Inválido ou Expirado
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground leading-relaxed">
                Este link de convite não é válido, já foi utilizado ou atingiu o prazo de validade. Solicite um novo link ao administrador da organização.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Link href="/login" className="w-full">
                <Button className="w-full bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-semibold py-2.5">
                  Voltar para o Login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // State 5: Token Valid — Render Signup Form to join invited workspace
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      <div className="w-full max-w-md relative z-10">
        <div className="mb-8 flex flex-col items-center justify-center">
          <CiclopesLogo
            layout="stacked"
            size="lg"
            variant="aegean"
            showTagline={true}
            taglineText="Muitas conversas. Uma visão."
          />
        </div>

        <Card className="w-full border-border bg-card shadow-lg">
          <CardHeader className="items-center text-center pb-4">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#1E3A5F]/10 dark:bg-primary/10 text-[#1E3A5F] dark:text-primary">
              <UsersRound className="h-5 w-5" />
            </div>
            <CardTitle className="text-xl font-bold font-sans text-foreground">
              Entrar em {peek.account_name}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <ShieldCheck className="size-3.5 text-primary" />
              <span>Função: {ROLE_LABEL[peek.role]}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignup} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fullName" className="text-xs font-semibold text-foreground">
                  Nome Completo
                </Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Seu nome"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                  className="border-border bg-background text-sm h-10"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                  E-mail Corporativo
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="voce@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="border-border bg-background text-sm h-10"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                  Senha
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo de 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="border-border bg-background text-sm h-10"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmPassword" className="text-xs font-semibold text-foreground">
                  Confirmar Senha
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repita sua senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="border-border bg-background text-sm h-10"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-2 w-full bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-semibold py-2.5 shadow-sm transition-all"
              >
                {loading ? "Criando credenciais..." : "Criar conta e aceitar convite"}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-border/50 text-center text-xs text-muted-foreground">
              Já possui uma conta?{" "}
              <Link
                href={`/login?invite=${encodeURIComponent(inviteToken)}`}
                className="font-semibold text-[#D16A3A] hover:underline"
              >
                Entrar com conta existente
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-xs text-muted-foreground/60 tracking-wider uppercase font-sans">
          Ciclopes • Sistema Operacional Comercial
        </div>
      </div>
    </div>
  );
}
