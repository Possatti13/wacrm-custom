"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
import { UsersRound, Lock, AlertCircle } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        // Secure unified error message to prevent user enumeration
        setError("E-mail ou senha incorretos. Verifique suas credenciais.");
        setLoading(false);
        return;
      }

      if (inviteToken) {
        router.push(`/join/${encodeURIComponent(inviteToken)}`);
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* Background Architectural Watermark Accent */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.03] dark:opacity-[0.05]">
        <svg width="600" height="600" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="45" stroke="#1E3A5F" strokeWidth="0.5" strokeDasharray="2 2" />
          <circle cx="50" cy="50" r="30" stroke="#1E3A5F" strokeWidth="0.5" />
          <path d="M 12 50 C 26 26, 74 26, 88 50 C 74 74, 26 74, 12 50 Z" stroke="#1E3A5F" strokeWidth="0.75" />
          <circle cx="50" cy="50" r="12" stroke="#1E3A5F" strokeWidth="0.5" />
        </svg>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
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
            {inviteToken ? (
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UsersRound className="h-5 w-5" />
              </div>
            ) : (
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#1E3A5F]/10 dark:bg-primary/10 text-[#1E3A5F] dark:text-primary">
                <Lock className="h-5 w-5" />
              </div>
            )}
            <CardTitle className="text-xl font-bold font-sans text-foreground">
              {inviteToken ? "Acesse para aceitar o convite" : "Entrar na sua operação"}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {inviteToken
                ? "Faça login para ingressar na organização convidada"
                : "Acesso disponível exclusivamente por convite"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

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
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                    Senha
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-[#D16A3A] hover:underline"
                  >
                    Esqueceu sua senha?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="border-border bg-background text-sm h-10"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-2 w-full bg-[#1E3A5F] hover:bg-[#162B46] text-[#F7F3EC] dark:bg-primary dark:text-primary-foreground font-semibold py-2.5 shadow-sm transition-all"
              >
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-border/50 text-center text-xs text-muted-foreground">
              {inviteToken ? (
                <div>
                  Novo membro?{" "}
                  <Link
                    href={`/signup?invite=${encodeURIComponent(inviteToken)}`}
                    className="font-semibold text-[#D16A3A] hover:underline"
                  >
                    Criar conta e aceitar convite
                  </Link>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground/80 leading-relaxed">
                  O Ciclopes opera em regime fechado. Novos membros entram exclusivamente através de convites emitidos pelos administradores de cada organização.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Subtle Institutional Brand Footer */}
        <div className="mt-8 text-center text-xs text-muted-foreground/60 tracking-wider uppercase font-sans">
          Ciclopes • Sistema Operacional Comercial
        </div>
      </div>
    </div>
  );
}
