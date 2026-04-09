/**
 * GET /api/quota
 *
 * Fetches the account subscription state from ElevenLabs (/v1/user) so the
 * UI can show the user how many TTS credits remain before they run a job.
 *
 * Requires the API key to have `user_read` permission. If the key is a
 * restricted/scoped key without that permission, returns { ok: false, ... }
 * so the UI can degrade gracefully (it just won't show live quota).
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "ELEVENLABS_API_KEY not set" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // Gracefully handle missing-permission (restricted keys)
      return NextResponse.json({
        ok: false,
        error: body?.detail?.message ?? `HTTP ${res.status}`,
        status: body?.detail?.status,
      });
    }

    const data = await res.json();
    const sub = data.subscription ?? {};
    return NextResponse.json({
      ok: true,
      tier: sub.tier,
      status: sub.status,
      charLimit: sub.character_limit,
      charUsed: sub.character_count,
      charRemaining: (sub.character_limit ?? 0) - (sub.character_count ?? 0),
      nextResetUnix: sub.next_character_count_reset_unix,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message });
  }
}
