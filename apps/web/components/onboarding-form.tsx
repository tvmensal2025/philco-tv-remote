"use client";

import { ArrowRight, Building2, Camera, Check, Sparkles, UtensilsCrossed } from "lucide-react";
import { useState } from "react";

export default function OnboardingForm({ email }: { email: string; config: { supabaseUrl: string; supabaseAnonKey: string } }) {
  const [organizationName, setOrganizationName] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationName, restaurantName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo" })
    });
    setLoading(false);
    if (response.ok) location.href = "/";
    else setError((await response.json()).error ?? "Não foi possível concluir a configuração.");
  }

  return (
    <main className="onboardingPage">
      <section className="onboardingCard">
        <div className="onboardingProgress"><span className="done"><Check/></span><i/><span className="current">2</span><i/><span>3</span></div>
        <span className="kicker"><Sparkles/> Primeiro acesso</span>
        <h1>Vamos preparar sua operação.</h1>
        <p className="onboardingLead">Criaremos sua organização, o primeiro restaurante e quatro câmeras prontas para receber vídeos.</p>
        <form onSubmit={submit}>
          <label htmlFor="organization">Nome do grupo ou empresa</label>
          <div className="inputWithIcon"><Building2/><input id="organization" required minLength={2} maxLength={80} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Ex.: Grupo Sabor & Arte"/></div>
          <label htmlFor="restaurant">Nome do primeiro restaurante</label>
          <div className="inputWithIcon"><UtensilsCrossed/><input id="restaurant" required minLength={2} maxLength={80} value={restaurantName} onChange={(event) => setRestaurantName(event.target.value)} placeholder="Ex.: Unidade Centro"/></div>
          <div className="onboardingPreview"><Camera/><div><strong>4 câmeras serão criadas</strong><small>Você poderá renomear e configurar os caminhos depois.</small></div></div>
          <button type="submit" className="primaryButton full" disabled={loading}>{loading ? "Preparando sua operação…" : <>Criar minha operação <ArrowRight/></>}</button>
          {error && <p className="formError" role="alert">{error}</p>}
        </form>
        <footer>Conectado como <strong>{email}</strong></footer>
      </section>
    </main>
  );
}
