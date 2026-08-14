import { NextResponse } from 'next/server';
import { restaurantSettingsSchema } from '@reelops/shared';
import { adminClient, requireContext, requireRole } from '@/lib/supabase';

export async function PUT(request: Request) {
  try {
    const ctx = await requireContext();
    requireRole(ctx.role, ['owner', 'admin']);
    const input = restaurantSettingsSchema.parse(await request.json());
    const { data: current } = await ctx.supabase
      .from('restaurants')
      .select('id,settings')
      .eq('id', input.restaurantId)
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (!current)
      return NextResponse.json({ error: 'Restaurante não encontrado.' }, { status: 404 });
    const currentSettings = (current.settings ?? {}) as Record<string, unknown>;
    const settings = {
      ...currentSettings,
      window_before: input.windowBefore,
      window_after: input.windowAfter,
      active_style: input.activeStyle,
      ...(input.autoCaptureMotion === undefined
        ? {}
        : { auto_capture_motion: input.autoCaptureMotion }),
      ...(input.capturePrompt === undefined ? {} : { capture_prompt: input.capturePrompt }),
      ...(input.autoHighlights === undefined ? {} : { auto_highlights: input.autoHighlights }),
      ...(input.maxAutoReelsPerDay === undefined
        ? {}
        : { max_auto_reels_per_day: input.maxAutoReelsPerDay }),
      ...(input.highlightMinScore === undefined
        ? {}
        : { highlight_min_score: input.highlightMinScore }),
      ...(input.whatsappDaily === undefined ? {} : { whatsapp_daily: input.whatsappDaily }),
      ...(input.whatsappPhone === undefined
        ? {}
        : { whatsapp_phone: input.whatsappPhone.replace(/\D/g, '') }),
      ...(input.digestHour === undefined ? {} : { digest_hour: input.digestHour }),
    };
    const { error } = await adminClient()
      .from('restaurants')
      .update({ name: input.name, timezone: input.timezone, settings })
      .eq('id', input.restaurantId)
      .eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro';
    return NextResponse.json(
      {
        error:
          message === 'FORBIDDEN' ? 'Apenas administradores podem alterar configurações.' : message,
      },
      { status: message === 'FORBIDDEN' ? 403 : 400 },
    );
  }
}
