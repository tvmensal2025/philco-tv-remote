import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { z } from "zod";
import { requireContext } from "@/lib/supabase";
import { ensureStorage } from "@/lib/storage";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext();
    const { id } = z.object({ id: z.string().uuid() }).parse(await params);
    const url = new URL(request.url);
    const type = url.searchParams.get("type") === "thumbnail" ? "thumbnail" : "video";
    const download = url.searchParams.get("download") === "1";
    const { data: reel } = await ctx.supabase.from("reels").select("id,output_path,thumbnail_path").eq("id", id).eq("tenant_id", ctx.tenantId).single();
    if (!reel) return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    const objectPath = type === "thumbnail" ? reel.thumbnail_path : reel.output_path;
    if (!objectPath) return NextResponse.json({ error: "Arquivo ainda não disponível." }, { status: 404 });
    if (!objectPath.startsWith(`generated/reels/${ctx.tenantId}/`)) return NextResponse.json({ error: "Caminho de mídia inválido." }, { status: 403 });

    const { storage, bucket } = await ensureStorage();
    const stat = await storage.statObject(bucket, objectPath);
    const range = request.headers.get("range");
    const contentType = type === "thumbnail" ? "image/jpeg" : "video/mp4";
    const commonHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff"
    };
    if (download) commonHeaders["Content-Disposition"] = `attachment; filename="reel-${id}.mp4"`;

    if (range && type === "video") {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      const length = end - start + 1;
      const stream = await storage.getPartialObject(bucket, objectPath, start, length);
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers: { ...commonHeaders, "Content-Length": String(length), "Content-Range": `bytes ${start}-${end}/${stat.size}` } });
    }

    const stream = await storage.getObject(bucket, objectPath);
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { ...commonHeaders, "Content-Length": String(stat.size) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Não autorizado." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
