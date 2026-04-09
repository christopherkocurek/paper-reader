import { NextResponse } from "next/server";
import { listVoices } from "@/lib/tts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const voices = await listVoices();
    // Return a trimmed payload the client actually needs
    return NextResponse.json({
      voices: voices.map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels,
        preview_url: v.preview_url,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
