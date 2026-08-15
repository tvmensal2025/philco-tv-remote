import type { CameraRole } from '@reelops/shared';
import type { Playbook } from './playbook.js';

export type CoverageScene = { role: CameraRole; duration: number; cameraId: string };

export function coverageReport(playbook: Playbook, scenes: CoverageScene[]) {
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0) || 1;
  const roles = new Set(scenes.map((scene) => scene.role));
  const shareByCamera = new Map<string, number>();
  const shareByRole = new Map<CameraRole, number>();
  for (const scene of scenes) {
    shareByCamera.set(
      scene.cameraId,
      (shareByCamera.get(scene.cameraId) ?? 0) + scene.duration / total,
    );
    shareByRole.set(scene.role, (shareByRole.get(scene.role) ?? 0) + scene.duration / total);
  }
  const adjacentSame = scenes.some(
    (scene, index) => index > 0 && scene.cameraId === scenes[index - 1]?.cameraId,
  );
  const overShare = [...shareByCamera.values()].some((share) => share > playbook.maxShare + 0.02);
  const foodShare = shareByRole.get('food') ?? 0;
  const kitchenShare = shareByRole.get('side') ?? 0;
  const first = scenes[0];
  const last = scenes[scenes.length - 1];

  let ok = scenes.length >= 3 && roles.size >= Math.min(playbook.minRoles, roles.size);
  let reason = 'ok';
  if (playbook.program === 'casa') {
    ok = scenes.length >= 1;
    if (!ok) reason = `COVERAGE:casa:takes=${scenes.length}:food=${foodShare.toFixed(2)}`;
  } else if (playbook.program === 'oficio') {
    ok = kitchenShare >= 0.35 && roles.size >= 2 && scenes.length >= 4;
    if (!ok) reason = `COVERAGE:oficio:kitchen=${kitchenShare.toFixed(2)}:roles=${roles.size}`;
  } else if (playbook.program === 'assinatura') {
    ok =
      first?.role !== 'food' &&
      last?.role !== 'food' &&
      foodShare >= 0.32 &&
      foodShare <= 0.62 &&
      scenes.length >= 4;
    if (!ok)
      reason = `COVERAGE:assinatura:first=${first?.role}:last=${last?.role}:food=${foodShare.toFixed(2)}`;
  } else {
    ok = roles.size >= 3 && !adjacentSame && !overShare && scenes.length >= 6;
    if (!ok) reason = `COVERAGE:pulso:roles=${roles.size}:adj=${adjacentSame}:share=${overShare}`;
  }

  return { ok, roles: [...roles], adjacentSame, overShare, foodShare, kitchenShare, reason };
}
