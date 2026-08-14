'use client';

import {
  ArrowRight,
  ArrowLeft,
  Building2,
  Camera,
  Check,
  Server,
  Clock,
  Activity,
  Zap,
  Film,
  CheckCircle2,
  Flame,
} from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CAMERA_ANGLES } from '@/lib/camera-roles';

const STEPS = [
  { id: 1, title: 'Estabelecimento', icon: Building2 },
  { id: 2, title: 'Mídia', icon: Server },
  { id: 3, title: 'Câmeras', icon: Camera },
  { id: 4, title: 'Horários', icon: Clock },
  { id: 5, title: 'Movimento', icon: Activity },
  { id: 6, title: 'Teste Real', icon: Zap },
  { id: 7, title: 'Primeiro Reel', icon: Film },
];

export default function OnboardingForm({
  email,
}: {
  email: string;
  config: { supabaseUrl: string; supabaseAnonKey: string };
}) {
  const [step, setStep] = useState(1);
  const [organizationName, setOrganizationName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function finishOnboarding() {
    setLoading(true);
    setError('');
    const response = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationName: organizationName || 'Minha Empresa',
        restaurantName: restaurantName || 'Restaurante Principal',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
      }),
    });
    setLoading(false);
    if (response.ok) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } else {
      setError((await response.json()).error ?? 'Não foi possível concluir a configuração.');
      setStep(1);
    }
  }

  const nextStep = () => {
    if (step === 7) finishOnboarding();
    else setStep((s) => s + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl space-y-8 animate-in fade-in zoom-in-95 duration-500">
        {/* PROGRESS BAR */}
        <div className="flex items-center justify-between relative px-4">
          <div className="absolute left-10 right-10 top-1/2 h-0.5 bg-border -z-10 -translate-y-1/2"></div>
          <div
            className="absolute left-10 right-10 top-1/2 h-0.5 bg-primary -z-10 -translate-y-1/2 transition-all duration-500 ease-in-out"
            style={{ width: `calc(${((step - 1) / 6) * 100}% - 20px)` }}
          ></div>

          {STEPS.map((s) => {
            const Icon = s.icon;
            const isCompleted = step > s.id;
            const isCurrent = step === s.id;

            return (
              <div key={s.id} className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-2',
                    isCompleted
                      ? 'bg-primary border-primary text-primary-foreground'
                      : isCurrent
                        ? 'bg-background border-primary text-primary shadow-[0_0_0_4px_rgba(var(--primary),0.1)]'
                        : 'bg-background border-muted-foreground/30 text-muted-foreground/50',
                  )}
                >
                  {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium hidden sm:block uppercase tracking-wider absolute mt-12',
                    isCurrent
                      ? 'text-primary'
                      : isCompleted
                        ? 'text-foreground'
                        : 'text-muted-foreground/50',
                  )}
                >
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>

        <Card className="shadow-xl border-primary/10 overflow-hidden relative min-h-[400px]">
          <CardContent className="p-8 sm:p-12 relative z-10 flex flex-col h-full justify-center">
            {error && (
              <div className="mb-6 p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm font-medium">
                {error}
              </div>
            )}

            {/* STEP 1: ESTABELECIMENTO */}
            {step === 1 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300">
                <div className="text-center space-y-2 mb-8">
                  <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight">Crie seu estabelecimento</h2>
                  <p className="text-muted-foreground">Como devemos chamar sua operação inicial?</p>
                </div>

                <div className="space-y-4 max-w-sm mx-auto">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome do Grupo/Empresa</label>
                    <input
                      required
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="Ex: Grupo Sabor & Arte"
                      className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome do Restaurante</label>
                    <input
                      required
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      placeholder="Ex: Unidade Centro"
                      className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: STORAGE */}
            {step === 2 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 text-center">
                <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                  <Server className="h-8 w-8 text-blue-600" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Armazenamento pronto</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Os ISOs ficam guardados com segurança até virarem Reel. Depois o bruto some.
                </p>

                <div className="max-w-md mx-auto mt-8 p-6 border rounded-xl bg-card text-left space-y-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <span className="font-medium text-sm">Cofre de vídeos configurado</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <span className="font-medium text-sm">
                      Políticas de retenção ativas (2 dias)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <span className="font-medium text-sm">Cada casa só vê a própria mídia</span>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: CÂMERAS */}
            {step === 3 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 text-center">
                <div className="mx-auto w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-6">
                  <Camera className="h-8 w-8 text-purple-600" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Cadastre suas Câmeras</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Vamos preparar a estrutura para receber os 4 ângulos principais da sua operação.
                </p>

                <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto mt-8">
                  {CAMERA_ANGLES.map((angle) => (
                    <div
                      key={angle.position}
                      className="p-4 border rounded-xl bg-muted/30 flex flex-col items-center justify-center gap-2"
                    >
                      <Camera className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm font-semibold">{angle.folder}</span>
                      <span className="text-xs text-muted-foreground text-center">
                        {angle.label} — {angle.hint}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 4: HORÁRIOS */}
            {step === 4 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 text-center">
                <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-6">
                  <Clock className="h-8 w-8 text-amber-600" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Horário de Funcionamento</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  A IA só processará vídeos dentro do seu horário de operação para economizar
                  recursos.
                </p>

                <div className="max-w-md mx-auto mt-8 p-6 border rounded-xl bg-card shadow-sm flex items-center justify-center gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase">
                      Abertura
                    </label>
                    <input
                      type="time"
                      defaultValue="08:00"
                      className="flex h-12 w-32 rounded-md border border-input bg-transparent px-3 text-lg font-mono text-center"
                    />
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground mt-6" />
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase">
                      Fechamento
                    </label>
                    <input
                      type="time"
                      defaultValue="18:00"
                      className="flex h-12 w-32 rounded-md border border-input bg-transparent px-3 text-lg font-mono text-center"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: MOVIMENTO */}
            {step === 5 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 text-center">
                <div className="mx-auto w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mb-6">
                  <Activity className="h-8 w-8 text-rose-600" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Detecção por Movimento</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Escolha como o sistema deve capturar momentos automaticamente quando não houver
                  acionamento manual.
                </p>

                <div className="max-w-md mx-auto mt-8 space-y-3 text-left">
                  <div className="p-4 border-2 border-primary rounded-xl bg-primary/5 flex items-start gap-4">
                    <div className="mt-0.5">
                      <div className="h-4 w-4 rounded-full border-[5px] border-primary"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">Detecção Nativa da Câmera (NVR)</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Usa o sensor de movimento da própria câmera. Menor custo de processamento.
                      </p>
                    </div>
                  </div>
                  <div className="p-4 border rounded-xl opacity-60 flex items-start gap-4">
                    <div className="mt-0.5">
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">Análise Contínua por IA (YOLO)</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Identifica pessoas e objetos em tempo real. Requer hardware dedicado (Em
                        breve).
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 6: TESTE REAL */}
            {step === 6 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 text-center">
                <div className="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-6">
                  <Zap className="h-8 w-8 text-orange-600" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Primeiro Teste</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Tudo configurado! Que tal testarmos o gatilho manual para gerar seu primeiro
                  conteúdo?
                </p>

                <div className="max-w-sm mx-auto mt-8">
                  <Button
                    size="lg"
                    className="w-full text-lg h-16 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-lg"
                    onClick={nextStep}
                  >
                    <Flame className="mr-2 h-6 w-6" /> MARCAR MOMENTO AGORA
                  </Button>
                  <p className="text-xs text-muted-foreground mt-4">
                    Isso simulará a marcação de um momento pelas câmeras.
                  </p>
                </div>
              </div>
            )}

            {/* STEP 7: PRIMEIRO REEL */}
            {step === 7 && (
              <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 text-center">
                <div className="mx-auto w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
                  <Film className="h-10 w-10 text-emerald-600" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Tudo pronto!</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  A IA criará seu primeiro Reel baseado nas configurações de teste. Você será
                  redirecionado para o seu novo Dashboard.
                </p>
              </div>
            )}
          </CardContent>

          <div className="bg-muted/50 p-4 border-t flex justify-between items-center relative z-10">
            <Button
              variant="ghost"
              onClick={prevStep}
              disabled={step === 1 || loading}
              className={step === 1 ? 'invisible' : ''}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>

            {step < 6 && (
              <Button
                onClick={nextStep}
                disabled={loading || (step === 1 && (!organizationName || !restaurantName))}
              >
                Continuar <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}

            {step === 6 && (
              <Button variant="ghost" onClick={nextStep} className="text-muted-foreground">
                Pular teste <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}

            {step === 7 && (
              <Button
                onClick={nextStep}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
              >
                {loading ? 'Criando ambiente...' : 'Ir para o Dashboard'}{' '}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </Card>

        <div className="text-center text-sm text-muted-foreground">
          Conectado como <strong>{email}</strong>
        </div>
      </div>
    </div>
  );
}
