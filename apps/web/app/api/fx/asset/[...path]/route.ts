import { existsSync, createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/supabase';
import { fxCatalogPath } from '@/lib/fx-catalog-path';

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    await requireContext();
    const segments = (await params).path ?? [];
    if (
      !segments.length ||
      segments.some((part) => part.includes('..') || part.includes('\\') || part.includes('\0'))
    ) {
      return NextResponse.json({ error: 'Asset inválido.' }, { status: 400 });
    }
    const catalogDir = path.dirname(fxCatalogPath());
    const file = path.resolve(catalogDir, ...segments);
    if (!file.startsWith(path.resolve(catalogDir))) {
      return NextResponse.json({ error: 'Asset inválido.' }, { status: 400 });
    }
    if (!existsSync(file)) return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 });
    const stat = statSync(file);
    const stream = createReadStream(file);
    const type = file.endsWith('.webm')
      ? 'video/webm'
      : file.endsWith('.json')
        ? 'application/json'
        : 'application/octet-stream';
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(stat.size),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Não autorizado.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}
