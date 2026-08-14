'use client';

import { createBrowserClient } from '@supabase/ssr';
import { ArrowRight, CheckCircle2, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type RuntimeConfig = { supabaseUrl: string; supabaseAnonKey: string };

export default function LoginForm({
  config,
  invalidLink,
}: {
  config: RuntimeConfig;
  invalidLink: boolean;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    invalidLink ? 'Este link expirou ou já foi utilizado. Solicite um novo acesso.' : '',
  );
  const supabase = useMemo(
    () => createBrowserClient(config.supabaseUrl, config.supabaseAnonKey),
    [config],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    const callback = `${location.origin}/auth/callback`;
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback },
    });
    setLoading(false);
    if (authError) setError('Não foi possível enviar o link. Confira o e-mail e tente novamente.');
    else setSent(true);
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary px-10 py-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-foreground/15">
            <Sparkles className="h-4 w-4" />
          </div>
          CenaPronta
        </div>
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-wider text-primary-foreground/70">
            Conteúdo no piloto automático
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            Momentos reais.
            <br />
            <em className="not-italic text-primary-foreground/80">Conteúdo inesquecível.</em>
          </h1>
          <p className="max-w-md text-primary-foreground/80">
            Suas câmeras viram conteúdo. Transforme as melhores cenas do restaurante em Reels
            prontos para publicar.
          </p>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Quatro câmeras sincronizadas
            </p>
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Renderização automática em 9:16
            </p>
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Sua mídia permanece sob seu controle
            </p>
          </div>
        </div>
        <p className="flex items-center gap-2 text-sm text-primary-foreground/70">
          <ShieldCheck className="h-4 w-4" /> Processamento privado e seguro
        </p>
      </section>

      <section className="flex items-center justify-center bg-muted/40 p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-4">
              <div className="mb-2 flex items-center gap-2 font-semibold lg:hidden">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                </div>
                CenaPronta
              </div>
              {sent ? (
                <div role="status" className="space-y-3 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Mail className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-semibold">Confira seu e-mail</h2>
                  <p className="text-sm text-muted-foreground">
                    Enviamos um link de acesso para <strong>{email}</strong>. Ele expira por
                    segurança.
                  </p>
                  <Button type="button" variant="outline" onClick={() => setSent(false)}>
                    Usar outro e-mail
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Acesso seguro
                  </p>
                  <h2 className="text-2xl font-semibold">Bem-vindo de volta</h2>
                  <p className="text-sm text-muted-foreground">
                    Entre sem senha. Enviaremos um link seguro para o seu e-mail.
                  </p>
                  <Label htmlFor="email">E-mail profissional</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="voce@restaurante.com"
                      className="h-10 pl-9"
                    />
                  </div>
                  <Button className="w-full" type="submit" disabled={loading}>
                    {loading ? (
                      'Enviando…'
                    ) : (
                      <>
                        Continuar com e-mail <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  {error && (
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" /> Não compartilhamos seus dados com
                    terceiros.
                  </p>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
