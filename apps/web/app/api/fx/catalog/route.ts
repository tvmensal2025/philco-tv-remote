import { existsSync, readFileSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { parseFxCatalog } from '@reelops/shared';
import { requireContext } from '@/lib/supabase';
import { fxCatalogPath } from '@/lib/fx-catalog-path';

export async function GET() {
  try {
    await requireContext();
    const file = fxCatalogPath();
    if (!existsSync(file)) return NextResponse.json({ assets: [] });
    return NextResponse.json(parseFxCatalog(JSON.parse(readFileSync(file, 'utf8'))));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      { error: message === 'UNAUTHORIZED' ? 'Não autorizado.' : message },
      { status: message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}
