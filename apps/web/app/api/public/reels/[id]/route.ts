import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { isTenantMediaPath, verifyPublicReel } from '@reelops/shared';
import { adminClient } from '@/lib/supabase';
import { ensureStorage } from '@/lib/storage';
import { getServerEnv } from '@/lib/env';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const env = getServerEnv();
    const { id } = z.object({ id: z.string().uuid() }).parse(await params);
    const url = new URL(request.url);
    const exp = Number(url.searchParams.get('exp') ?? '');
    const sig = url.searchParams.get('sig') ?? '';
    const secret = env.INGEST_API_KEY;
    if (!verifyPublicReel(id, exp, sig, secret)) {
      return NextResponse.json({ error: 'Link expirado ou inválido.' }, { status: 403 });
    }

    await enforceRateLimit(`public-reel:${id}`, 30, 60);

    const { data: reel } = await adminClient()
      .from('reels')
      .select('id,tenant_id,output_path,status')
      .eq('id', id)
      .in('status', ['ready', 'approved', 'published'])
      .single();
    if (!reel?.output_path || !isTenantMediaPath(reel.output_path, reel.tenant_id)) {
      return NextResponse.json({ error: 'Mídia não encontrada.' }, { status: 404 });
    }

    const { storage, bucket } = await ensureStorage();
    const stat = await storage.statObject(bucket, reel.output_path);
    const headers: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    };
    const range = request.headers.get('range');
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
      const stream = await storage.getPartialObject(bucket, reel.output_path, start, length);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }

    const stream = await storage.getObject(bucket, reel.output_path);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { ...headers, 'Content-Length': String(stat.size) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'RATE_LIMITED' ? 'Muitas tentativas.' : message },
      { status: message === 'RATE_LIMITED' ? 429 : 400 },
    );
  }
}
