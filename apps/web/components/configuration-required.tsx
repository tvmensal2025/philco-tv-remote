import { CircleAlert, Sparkles } from 'lucide-react';
import { getConfigItems } from '@/lib/env';
import CopyConfigButton from '@/components/copy-config-button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ConfigurationRequired() {
  const items = getConfigItems().filter((item) => item.required && !item.configured);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              CenaPronta
            </div>
            <Badge variant="warning">
              <CircleAlert className="mr-1 h-3.5 w-3.5" />
              {items.length} obrigatórias
            </Badge>
          </div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Configuração da instalação
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Preencha o arquivo .env</h1>
          <CardDescription>
            O app lê as variáveis na raiz do repositório. Depois de salvar, reinicie o{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run dev</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item) => (
            <div className="flex items-start gap-3 rounded-lg border p-3" key={item.key}>
              <CircleAlert className="mt-0.5 h-4 w-4 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.label}</p>
                <code className="block truncate text-xs text-muted-foreground">{item.key}</code>
                <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
              </div>
              <CopyConfigButton value={item.key} />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
