import { CheckCircle2, CircleAlert, Blocks } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ExistingCamerasGuide from '@/components/existing-cameras-guide';

type ConfigItem = {
  key: string;
  label: string;
  configured: boolean;
  required: boolean;
  hint: string;
};

export default function IntegrationsPanel({
  items,
  instagramEnabled,
}: {
  items: ConfigItem[];
  instagramEnabled: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ExistingCamerasGuide />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Blocks className="h-4 w-4" /> Conexões da casa
          </CardTitle>
          <CardDescription>O que já está pronto para publicar e armazenar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-medium">Instagram profissional</p>
              <p className="text-sm text-muted-foreground">
                Publica no Instagram depois que você aprova o Reel.
              </p>
            </div>
            <Badge variant={instagramEnabled ? 'success' : 'secondary'}>
              {instagramEnabled ? 'Ligado' : 'Opcional'}
            </Badge>
          </div>
          {items.map((item) => (
            <div key={item.key} className="flex items-center gap-3 rounded-lg border p-3">
              {item.configured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <CircleAlert className="h-4 w-4 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.hint}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
