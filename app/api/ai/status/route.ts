import { NextResponse } from "next/server";
import { getRuntimeAIStatus } from "@/lib/ai/runtimeStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getRuntimeAIStatus(), { headers: { "Cache-Control": "no-store" } });
}
