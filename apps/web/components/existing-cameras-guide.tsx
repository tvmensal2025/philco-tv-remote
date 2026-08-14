import { FolderOpen, MonitorPlay, Video } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ExistingCamerasGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Câmeras que a casa já tem</CardTitle>
        <CardDescription>
          Não troca equipamento. O gravador continua gravando. A gente só aproveita o que já sai
          dele.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-4">
          <Video className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">1. Vocês não mexem</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Câmera na parede, cabo, gravador. Fica como está. Intelbras, Hikvision, Intelbras DVR —
            tanto faz a marca.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <FolderOpen className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">2. O técnico aponta uma vez</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No gravador: “quando tiver movimento, salvar o vídeo nesta pasta”. Canal 1 na pasta
            Serviço, canal 2 na Cozinha, e assim por diante.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <MonitorPlay className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">3. O CenaPronta pega sozinho</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Um programinha no computador ao lado do gravador sobe o arquivo. Cai a internet? Ele
            espera. O dono só abre o quadro e gera o Reel.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
