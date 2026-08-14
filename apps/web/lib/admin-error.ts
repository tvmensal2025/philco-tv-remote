import { NextResponse } from 'next/server';

export function adminError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Erro';
  if (message === 'UNAUTHORIZED')
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  if (message === 'FORBIDDEN')
    return NextResponse.json({ error: 'Só o administrador da plataforma.' }, { status: 403 });
  if (message === 'RATE_LIMITED')
    return NextResponse.json({ error: 'Muitas alterações. Espere um pouco.' }, { status: 429 });
  return NextResponse.json({ error: message }, { status: 400 });
}
