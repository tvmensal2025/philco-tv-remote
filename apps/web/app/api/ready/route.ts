import { NextResponse } from "next/server";
import { isCoreConfigured } from "@/lib/env";

export function GET() {
  return NextResponse.json({ ready: true, configured: isCoreConfigured() });
}
