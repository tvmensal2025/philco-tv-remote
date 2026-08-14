import { config } from '../config.js';

export type RepairCase = 'poor_crop' | 'text_overflow' | 'black_frame_boundary' | 'bad_transition';

export function canAutoRepair(code: string): RepairCase | null {
  if (code === 'TITLE_OVERFLOW') return 'text_overflow';
  if (code === 'WIDTH' || code === 'HEIGHT') return 'poor_crop';
  return null;
}

export function autoRepairStatus() {
  return {
    enabled: config.ENABLE_AUTO_REPAIR,
    maxAttempts: config.MAX_AUTO_REPAIR_ATTEMPTS,
    classification: config.ENABLE_AUTO_REPAIR ? 'ARCHITECTURE READY' : 'NOT ENABLED',
  };
}
