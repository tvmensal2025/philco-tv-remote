'use client';

import { useEffect, useState } from 'react';
import VideoEditor, { createEmptyProject } from '@/components/video-editor/video-editor';
import { parseVideoProject, type VideoProject } from '@reelops/shared';

export default function LocalEditorPage() {
  const [initial, setInitial] = useState<VideoProject | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('cenapronta.editor.local');
      const parsed = raw ? parseVideoProject(JSON.parse(raw)) : null;
      setInitial(parsed?.success ? parsed.data : createEmptyProject({ name: 'Projeto manual' }));
    } catch {
      setInitial(createEmptyProject({ name: 'Projeto manual' }));
    }
  }, []);
  if (!initial)
    return (
      <div className="nle flex h-dvh items-center justify-center text-sm text-[#8d97a8]">
        Abrindo editor…
      </div>
    );
  return <VideoEditor initial={initial} title="Editor" />;
}
