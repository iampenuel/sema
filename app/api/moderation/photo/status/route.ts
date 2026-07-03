import { NextResponse } from "next/server";
import { photoModerationStatus } from "@/lib/photo/azureModeration";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(photoModerationStatus(), { headers: { "Cache-Control": "no-store" } });
}
