import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { isTenantMediaPath } from '@reelops/shared';
import { requireContext } from '@/lib/supabase';
import { ensureStorage } from '@/lib/storage';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(await params);
    const { data: recording } = await ctx.supabase
      .from('recordings')
      .select('id,object_key')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!recording?.object_key)
      return NextResponse.json({ error: 'Gravação não encontrada.' }, { status: 404 });
    if (!isTenantMediaPath(recording.object_key, ctx.tenantId))
      return NextResponse.json({ error: 'Caminho de mídia inválido.' }, { status: 403 });

    const { storage, bucket } = await ensureStorage();
    const stat = await storage.statObject(bucket, recording.object_key);
    const range = request.headers.get('range');
    const headers: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=30',
      'X-Content-Type-Options': 'nosniff',
    };

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      const length = end - start + 1;
      const stream = await storage.getPartialObject(bucket, recording.object_key, start, length);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }

    const stream = await storage.getObject(bucket, recording.object_key);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { ...headers, 'Content-Length': String(stat.size) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Não autorizado.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}
