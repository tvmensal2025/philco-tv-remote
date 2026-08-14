import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { adminError } from '@/lib/admin-error';

export async function GET() {
  try {
    const admin = await requirePlatformAdmin();
    return NextResponse.json({ email: admin.user.email, role: admin.role });
  } catch (error) {
    return adminError(error);
  }
}
