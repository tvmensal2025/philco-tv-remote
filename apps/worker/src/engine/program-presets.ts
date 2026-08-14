import type { EditProgram, Playbook } from '@reelops/shared';
import { playbookFor, programPresetSpecSchema, specToPlaybook } from '@reelops/shared';
import { db, log } from '../services.js';

const CACHE_MS = 15_000;
let cache: { at: number; books: Partial<Record<EditProgram, Playbook>> } | null = null;

export async function loadPublishedPlaybook(program: EditProgram): Promise<Playbook> {
  const books = await loadPublishedPlaybooks();
  return books[program] ?? playbookFor(program);
}

export async function loadPublishedPlaybooks(): Promise<Partial<Record<EditProgram, Playbook>>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.books;
  try {
    const { data, error } = await db
      .from('platform_program_presets')
      .select('program,spec')
      .eq('status', 'published');
    if (error) throw error;
    const books: Partial<Record<EditProgram, Playbook>> = {};
    for (const row of data ?? []) {
      const parsed = programPresetSpecSchema.safeParse(row.spec);
      if (!parsed.success) continue;
      if (parsed.data.program !== row.program) continue;
      books[parsed.data.program] = specToPlaybook(parsed.data);
    }
    cache = { at: Date.now(), books };
    return books;
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'published program presets unavailable; using validated defaults',
    );
    cache = { at: Date.now(), books: {} };
    return {};
  }
}

export function clearPublishedPlaybookCache() {
  cache = null;
}
