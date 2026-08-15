'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import VideoEditor from '@/components/video-editor/video-editor';
import type { VideoProject } from '@reelops/shared';

export default function ReelEditorPage() {
  const params = useParams<{ reelId: string }>();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [title, setTitle] = useState('Editor');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/editor/${params.reelId}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Falha ao abrir o projeto');
        if (!cancelled) {
          setProject(body.project);
          setTitle(body.reel?.title ?? 'Editor');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro');
      });
    return () => {
      cancelled = true;
    };
  }, [params.reelId]);

  if (error) {
    return (
      <div className="nle flex h-dvh items-center justify-center text-sm text-[#8d97a8]">
        {error}
      </div>
    );
  }
  if (!project) {
    return (
      <div className="nle flex h-dvh items-center justify-center text-sm text-[#8d97a8]">
        Abrindo projeto…
      </div>
    );
  }
  return <VideoEditor initial={project} reelId={params.reelId} title={title} />;
}
