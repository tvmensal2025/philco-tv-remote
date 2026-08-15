export const EDITOR_SHORTCUTS = [
  { combo: 'Space', action: 'play-pause', label: 'Play / Pause' },
  { combo: 'J', action: 'back', label: 'Recuar' },
  { combo: 'K', action: 'pause', label: 'Pausar' },
  { combo: 'L', action: 'forward', label: 'Avançar' },
  { combo: 'ArrowLeft', action: 'frame-back', label: 'Frame anterior' },
  { combo: 'ArrowRight', action: 'frame-forward', label: 'Próximo frame' },
  { combo: 'Home', action: 'start', label: 'Início' },
  { combo: 'End', action: 'end', label: 'Fim' },
  { combo: 'Mod+Z', action: 'undo', label: 'Desfazer' },
  { combo: 'Mod+Y', action: 'redo', label: 'Refazer' },
  { combo: 'Mod+Shift+Z', action: 'redo', label: 'Refazer' },
  { combo: 'Mod+B', action: 'split', label: 'Cortar no playhead' },
  { combo: 'Mod+D', action: 'duplicate', label: 'Duplicar' },
  { combo: 'Mod+C', action: 'copy', label: 'Copiar' },
  { combo: 'Mod+V', action: 'paste', label: 'Colar' },
  { combo: 'Delete', action: 'delete', label: 'Apagar' },
  { combo: 'Backspace', action: 'delete', label: 'Apagar' },
  { combo: 'Mod+Backspace', action: 'ripple-delete', label: 'Ripple delete' },
  { combo: 'S', action: 'snap', label: 'Snap' },
  { combo: 'M', action: 'marker', label: 'Marker' },
  { combo: 'L', action: 'lock', label: 'Lock (com Shift)' },
] as const;

export type EditorAction = (typeof EDITOR_SHORTCUTS)[number]['action'] | 'lock';

export function matchEditorShortcut(event: KeyboardEvent): EditorAction | null {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return null;
  }
  const mod = event.metaKey || event.ctrlKey;
  if (event.code === 'Space') return 'play-pause';
  if (event.key === 'j' || event.key === 'J') return 'back';
  if (event.key === 'k' || event.key === 'K') return 'pause';
  if ((event.key === 'l' || event.key === 'L') && event.shiftKey) return 'lock';
  if (event.key === 'l' || event.key === 'L') return 'forward';
  if (event.key === 'ArrowLeft') return event.shiftKey ? 'back' : 'frame-back';
  if (event.key === 'ArrowRight') return event.shiftKey ? 'forward' : 'frame-forward';
  if (event.key === 'Home') return 'start';
  if (event.key === 'End') return 'end';
  if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) return 'redo';
  if (mod && event.key.toLowerCase() === 'z') return 'undo';
  if (mod && event.key.toLowerCase() === 'y') return 'redo';
  if (mod && event.key.toLowerCase() === 'b') return 'split';
  if (mod && event.key.toLowerCase() === 'd') return 'duplicate';
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return mod ? 'ripple-delete' : 'delete';
  }
  if (event.key === 's' || event.key === 'S') return 'snap';
  if (event.key === 'm' || event.key === 'M') return 'marker';
  return null;
}
