import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { parseFxCatalog } from '@reelops/shared';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';

function catalogPath() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, 'assets', 'fx', 'catalog.json');
    if (existsSync(file)) return file;
    dir = path.dirname(dir);
  }
  return path.join(process.cwd(), '../../assets/fx/catalog.json');
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const file = catalogPath();
    if (!existsSync(file)) return NextResponse.json({ assets: [] });
    const catalog = parseFxCatalog(JSON.parse(readFileSync(file, 'utf8')));
    return NextResponse.json(catalog);
  } catch (error) {
    return adminError(error);
  }
}
