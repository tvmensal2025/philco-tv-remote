import { defaultCameraRole, parseCameraRole, type CameraRole } from '@reelops/shared';

export { playbookFor, specToPlaybook, type Playbook, type PlaybookBeat } from '@reelops/shared';

export function cameraRoleOf(position: number, raw?: unknown): CameraRole {
  return parseCameraRole(raw) ?? defaultCameraRole(position);
}
