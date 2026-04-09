/**
 * POST /api/voice-preview
 *
 * Body (JSON):
 *   { provider: "elevenlabs" | "openai", voiceId: string, modelId?: string }
 *
 * Returns a short audio/mpeg clip (~90 chars of sample text) so the user can
 * A/B voices in the UI before committing to a full paper generation.
 *
 * Cost per preview is trivial:
 *   - OpenAI tts-1:    ~$0.0014
 *   - ElevenLabs flash: ~45 credits
 */

import { NextRequest, NextResponse } from "next/server";
import { generateChunk as generateElevenLabsChunk } from "@/lib/tts";
import { generateVoicePreview as generateOpenAiPreview } from "@/lib/tts-openai";

export const runtime = "nodejs";

const PREVIEW_TEXT =
  "Research papers come alive when narration is clear and measured, letting ideas breathe.";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = body.provider as "elevenlabs" | "openai";
    const voiceId = body.voiceId as string;
    const modelId = body.modelId as string | undefined;

    if (!voiceId) {
      return NextResponse.json({ error: "voiceId required" }, { status: 400 });
    }

    let audio: Uint8Array;
    if (provider === "openai") {
      audio = await generateOpenAiPreview({ voiceId, modelId });
    } else if (provider === "elevenlabs") {
      const result = await generateElevenLabsChunk({
        text: PREVIEW_TEXT,
        voiceId,
        modelId: modelId ?? "eleven_flash_v2_5",
      });
      audio = new Uint8Array(result.audio);
    } else {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}` },
        { status: 400 },
      );
    }

    return new Response(audio as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
