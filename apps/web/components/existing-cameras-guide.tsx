import { FolderOpen, MonitorPlay, Smartphone, Video } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ExistingCamerasGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Como a casa manda o vídeo</CardTitle>
        <CardDescription>
          Não precisa de HD. Muita câmera só existe no app. Escolha o caminho que a casa tem.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-4">
          <Video className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">1. Sofia + RTSP</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A Sofia acha o gravador na Wi-Fi da casa. Analogica não tem IP: o que aparece é o DVR, e
            os canais 1–4 entram sozinhos. Sem gravador na rede, use o celular ou a pasta.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <Smartphone className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">2. App da câmera</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Se o vídeo só está no iCSee, XMEye ou Intelbras Cloud, baixe o clipe no celular e envie
            em{' '}
            <Link
              href="/enviar"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Enviar
            </Link>
            . Sem pasta, sem HD.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <FolderOpen className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">3. Pasta do gravador</p>
          <p className="mt-1 text-sm text-muted-foreground">
            O caminho clássico: <span className="font-mono">C:\CenaPronta\cameras\C1</span> a C4. Só
            quando o técnico tem o HD. O Uploader lê e não mexe no original.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4 sm:col-span-3">
          <MonitorPlay className="mb-3 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">O dono só corta o Reel</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Com o vídeo no CenaPronta, o quadro gera o filme. Cai a internet? O Uploader espera. O
            clipe do celular sobe quando a rede voltar.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
