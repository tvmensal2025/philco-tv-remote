"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight, CheckCircle2, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

type RuntimeConfig = { supabaseUrl: string; supabaseAnonKey: string };

export default function LoginForm({ config, invalidLink }: { config: RuntimeConfig; invalidLink: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(invalidLink ? "Este link expirou ou já foi utilizado. Solicite um novo acesso." : "");
  const supabase = useMemo(() => createBrowserClient(config.supabaseUrl, config.supabaseAnonKey), [config]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const callback = `${location.origin}/auth/callback`;
    const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback } });
    setLoading(false);
    if (authError) setError("Não foi possível enviar o link. Confira o e-mail e tente novamente.");
    else setSent(true);
  }

  return (
    <main className="authPage">
      <section className="authStory">
        <div className="authBrand"><span className="brandMark">R</span><span>ReelOps</span></div>
        <div className="authCopy">
          <span className="kicker light"><Sparkles size={14} /> Conteúdo no piloto automático</span>
          <h1>Momentos reais.<br/><em>Conteúdo inesquecível.</em></h1>
          <p>Transforme as melhores cenas do seu restaurante em Reels prontos para encantar e publicar.</p>
          <div className="authBenefits">
            <span><CheckCircle2 /> Quatro câmeras sincronizadas</span>
            <span><CheckCircle2 /> Renderização automática em 9:16</span>
            <span><CheckCircle2 /> Sua mídia permanece sob seu controle</span>
          </div>
        </div>
        <div className="authFoot"><ShieldCheck /> Processamento privado e seguro</div>
      </section>
      <section className="authPanel">
        <form className="authCard" onSubmit={submit}>
          <div className="mobileLogo"><span className="brandMark">R</span> ReelOps</div>
          {sent ? (
            <div className="sentState" role="status">
              <span className="sentIcon"><Mail /></span>
              <h2>Confira seu e-mail</h2>
              <p>Enviamos um link de acesso para <strong>{email}</strong>. Ele expira por segurança.</p>
              <button type="button" className="secondaryButton" onClick={() => setSent(false)}>Usar outro e-mail</button>
            </div>
          ) : (
            <>
              <span className="kicker">Acesso seguro</span>
              <h2>Bem-vindo de volta</h2>
              <p className="formLead">Entre sem senha. Enviaremos um link seguro para o seu e-mail.</p>
              <label htmlFor="email">E-mail profissional</label>
              <div className="inputWithIcon"><Mail /><input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@restaurante.com" /></div>
              <button className="primaryButton full" type="submit" disabled={loading}>{loading ? "Enviando…" : <>Continuar com e-mail <ArrowRight /></>}</button>
              {error && <p className="formError" role="alert">{error}</p>}
              <small className="privacyNote"><ShieldCheck /> Não compartilhamos seus dados com terceiros.</small>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
