'use client';

import { useEffect, useRef, useState } from 'react';
import {
  previewProjectAt,
  mediaById,
  type ProjectPreviewLayer,
  type ProjectPreviewFrame,
  type VideoProject,
} from '@reelops/shared';
import { subscribePlayback, getPlayback } from './playback-store';

function LayerVideo({
  layer,
  url,
  playing,
}: {
  layer: ProjectPreviewLayer;
  url?: string;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const targetRef = useRef(layer.sourceTimeMs / 1000);
  targetRef.current = layer.sourceTimeMs / 1000;

  useEffect(() => {
    const video = ref.current;
    if (!video || !url) return;
    const snap = (force: boolean) => {
      const next = Math.max(0, targetRef.current);
      if (force || Math.abs(video.currentTime - next) > 0.12) video.currentTime = next;
    };
    const onReady = () => snap(true);
    video.addEventListener('loadedmetadata', onReady);
    if (video.readyState >= 1) snap(true);
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, [url]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !url) return;
    const next = Math.max(0, targetRef.current);
    if (!playing) {
      video.pause();
      if (Math.abs(video.currentTime - next) > 0.04) video.currentTime = next;
      return;
    }
    if (Math.abs(video.currentTime - next) > 0.18) video.currentTime = next;
    void video.play().catch(() => undefined);
  }, [playing, url]);

  return (
    <div
      className="absolute inset-0 origin-center overflow-hidden"
      style={{
        opacity: layer.opacity,
        transform: `translate(${layer.transform.x}%, ${layer.transform.y}%) scale(${layer.scale}) rotate(${layer.transform.rotation}deg)`,
      }}
    >
      {url ? (
        <video
          ref={ref}
          src={url}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-[#161b24] text-xs text-[#8d97a8]">
          {layer.clip.name}
        </div>
      )}
    </div>
  );
}

export default function PreviewMonitor({
  project,
  compare,
}: {
  project: VideoProject;
  compare: boolean;
}) {
  const [frame, setFrame] = useState<ProjectPreviewFrame | null>(() =>
    previewProjectAt(project, getPlayback().timeMs),
  );
  const [playing, setPlaying] = useState(getPlayback().playing);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    let frameId = 0;
    let last = 0;
    const tick = () => {
      const playback = getPlayback();
      setPlaying(playback.playing);
      const now = performance.now();
      if (!playback.playing || now - last > 32) {
        last = now;
        setFrame(previewProjectAt(projectRef.current, playback.timeMs));
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    const unsub = subscribePlayback(() => {
      const playback = getPlayback();
      if (!playback.playing) setFrame(previewProjectAt(projectRef.current, playback.timeMs));
    });
    return () => {
      cancelAnimationFrame(frameId);
      unsub();
    };
  }, []);

  const width = project.settings.width;
  const height = project.settings.height;
  const outgoing = frame?.outgoing;
  const incoming = frame?.incoming;
  const firstMedia = outgoing ? mediaById(project, outgoing.clip.mediaId) : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="nle-monitor-well">
        <div
          className="relative overflow-hidden bg-black shadow-[0_0_0_1px_#262d3a,0_24px_80px_rgba(0,0,0,0.55)]"
          style={{
            aspectRatio: `${width} / ${height}`,
            height: '100%',
            maxHeight: '100%',
            maxWidth: '100%',
          }}
        >
          {outgoing ? (
            <LayerVideo
              layer={outgoing}
              url={firstMedia?.previewUrl ?? firstMedia?.proxyUrl}
              playing={playing && outgoing.opacity > 0.02}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] tracking-[0.16em] uppercase text-[#8d97a8]">
              Solte mídia na timeline
            </div>
          )}
          {incoming && incoming.clip.id !== outgoing?.clip.id ? (
            <LayerVideo
              layer={incoming}
              url={mediaById(project, incoming.clip.mediaId)?.previewUrl}
              playing={playing && incoming.opacity > 0.02}
            />
          ) : null}
          {(frame?.fadeBlack ?? 0) > 0 ? (
            <div className="absolute inset-0 bg-black" style={{ opacity: frame?.fadeBlack }} />
          ) : null}
          {(frame?.fadeWhite ?? 0) > 0 ? (
            <div className="absolute inset-0 bg-white" style={{ opacity: frame?.fadeWhite }} />
          ) : null}
          {project.settings.safeAreas ? (
            <>
              <div className="pointer-events-none absolute inset-[8%] border border-white/15" />
              <div className="pointer-events-none absolute inset-[14%] border border-white/10" />
            </>
          ) : null}
          {frame?.captions[0] ? (
            <div className="pointer-events-none absolute inset-x-6 bottom-8 text-center text-[13px] font-semibold text-white [text-shadow:0_1px_2px_#000]">
              {frame.captions[0]}
            </div>
          ) : null}
          {compare && firstMedia?.previewUrl ? (
            <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden border-r border-white/40">
              <video
                src={firstMedia.previewUrl}
                className="h-full w-[200%] object-cover"
                muted
                playsInline
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
