/**
 * GET /api/voices
 *
 * Returns voices and models for BOTH TTS providers in a single payload so the
 * UI can switch between them without a second fetch:
 *
 *   {
 *     elevenlabs: {
 *       ok: true | false,
 *       usable: Voice[],
 *       locked: Voice[],
 *       totalCount, usableCount
 *     },
 *     openai: {
 *       voices: [{ id, name, description, narrationRecommended }],
 *       models: [{ id, label, costPer1M }]
 *     }
 *   }
 */

import { NextResponse } from "next/server";
import { listVoices } from "@/lib/tts";
import { OPENAI_VOICES, OPENAI_MODELS } from "@/lib/tts-openai";

export const runtime = "nodejs";

export async function GET() {
  // Fetch ElevenLabs voices (may fail if key is missing or restricted)
  let elevenlabs: Record<string, unknown> = {
    ok: false,
    usable: [],
    locked: [],
    totalCount: 0,
    usableCount: 0,
  };
  try {
    const voices = await listVoices();
    const usable = voices
      .filter((v) => v.is_owner === true)
      .map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels,
        preview_url: v.preview_url,
        is_owner: true,
      }));
    const locked = voices
      .filter((v) => v.is_owner !== true)
      .map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels,
        preview_url: v.preview_url,
        is_owner: false,
      }));
    elevenlabs = {
      ok: true,
      usable,
      locked,
      totalCount: voices.length,
      usableCount: usable.length,
    };
  } catch (err) {
    elevenlabs = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      usable: [],
      locked: [],
      totalCount: 0,
      usableCount: 0,
    };
  }

  // OpenAI voices are hardcoded constants — no network call needed
  const openai = {
    ok: !!process.env.OPENAI_API_KEY,
    voices: OPENAI_VOICES,
    models: OPENAI_MODELS,
  };

  return NextResponse.json({ elevenlabs, openai });
}
