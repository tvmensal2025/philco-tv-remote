import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveEditingIntensityProfile } from '@reelops/shared';
const values = [0.2, 0.5, 0.8];
const rows = values.map((value) => ({ value, ...resolveEditingIntensityProfile(value) }));
mkdirSync('work/validation', { recursive: true });
writeFileSync('work/validation/edit-intensity.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
