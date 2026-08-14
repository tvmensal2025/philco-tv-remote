export const CAMERA_PLACES = [
  { place: 'servico', role: 'master', label: 'Serviço', hint: 'Balcão e acolhida' },
  { place: 'cozinha', role: 'side', label: 'Cozinha', hint: 'Mãos e ofício' },
  { place: 'prato', role: 'food', label: 'Prato', hint: 'Close da comida' },
  { place: 'sala', role: 'ambience', label: 'Sala', hint: 'Salão e atmosfera' },
  { place: 'quarto', role: 'ambience', label: 'Quarto', hint: 'Ambiente íntimo' },
  { place: 'fachada', role: 'ambience', label: 'Fachada', hint: 'Entrada e rua' },
  { place: 'hall', role: 'ambience', label: 'Hall', hint: 'Recepção' },
  { place: 'estoque', role: 'side', label: 'Estoque', hint: 'Retaguarda' },
] as const;

export const CUSTOM_PLACE = 'custom';
export const EDITOR_ROLES = [
  { role: 'master', label: 'Serviço' },
  { role: 'side', label: 'Cozinha' },
  { role: 'food', label: 'Prato' },
  { role: 'ambience', label: 'Sala' },
] as const;

export type CameraPlace = (typeof CAMERA_PLACES)[number]['place'] | typeof CUSTOM_PLACE;

export const CAMERA_ANGLES = CAMERA_PLACES.slice(0, 4).map((item, index) => ({
  position: index + 1,
  role: item.role,
  folder: `C${index + 1}`,
  label: item.label,
  hint: item.hint,
  path: `C:\\CenaPronta\\cameras\\C${index + 1}`,
  place: item.place,
}));

export const CAMERA_ROLE_OPTIONS = CAMERA_PLACES.map((item) => ({
  value: item.role,
  place: item.place,
  label: item.label,
  hint: item.hint,
}));

export function isKnownPlace(place?: string | null) {
  return Boolean(place && CAMERA_PLACES.some((item) => item.place === place));
}

export function slugPlace(label: string) {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || CUSTOM_PLACE;
}

export function roleForPlace(place?: string | null) {
  return CAMERA_PLACES.find((item) => item.place === place)?.role ?? 'ambience';
}

export function defaultPlace(position: number) {
  return CAMERA_PLACES[Math.min(Math.max(position, 1), 4) - 1]?.place ?? 'sala';
}

export function cameraPlaceOf(place?: string | null, role?: string | null, position?: number) {
  if (isKnownPlace(place)) return place as string;
  if (place) return place;
  if (role) {
    const match = CAMERA_PLACES.find((item) => item.role === role);
    if (match) return match.place;
  }
  return defaultPlace(position ?? 1);
}

export function selectPlaceValue(place?: string | null, role?: string | null, position?: number) {
  const resolved = cameraPlaceOf(place, role, position);
  return isKnownPlace(resolved) ? resolved : CUSTOM_PLACE;
}

export function cameraRoleLabel(
  role?: string | null,
  position?: number,
  place?: string | null,
  placeLabel?: string | null,
) {
  if (placeLabel?.trim()) return placeLabel.trim();
  if (place && !isKnownPlace(place) && place !== CUSTOM_PLACE) {
    return place.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
  const resolved = CAMERA_PLACES.find(
    (item) => item.place === cameraPlaceOf(place, role, position),
  );
  return resolved?.label ?? 'Serviço';
}

export function mosaicColumns(tileCount: number) {
  if (tileCount <= 1) return 1;
  if (tileCount <= 4) return 2;
  if (tileCount <= 9) return 3;
  return 4;
}
