import path from 'node:path';

export function camerasInboxRoot() {
  return process.env.CAMERA_INBOX_DIR?.trim() || path.join('C:', 'CenaPronta', 'cameras');
}

export function cameraInboxPath(position: number) {
  return path.join(camerasInboxRoot(), `C${position}`);
}
