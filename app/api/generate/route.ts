/**
 * POST /api/generate
 *
 * Multipart form:
 *   - voiceId:   string (ElevenLabs voice ID)
 *   - modelId:   string (e.g. "eleven_multilingual_v2")
 *   - skipLlm:   "true" | "false" (optional — skip LLM rewrite for faster/cheaper runs)
 *   - kind:      "text" | "pdf"
 *   - text:      string (when kind=text)
 *   - file:      File (when kind=pdf)
 *
 * Returns: audio/mpeg stream (the generated MP3)
 */

import { NextRequest, NextResponse } from "next/server";
import { cleanText } from "@/lib/clean";
import { chunkText } from "@/lib/chunk";
import { rewriteChunks } from "@/lib/llm";
import { generateFullAudio } from "@/lib/tts";
import { extractPdfText } from "@/lib/pdf";

export const runtime = "nodejs";
// Long documents + TTS calls can take a while; bump the default 10s timeout.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const voiceId = String(form.get("voiceId") || "");
    const modelId = String(form.get("modelId") || "eleven_multilingual_v2");
    const skipLlm = form.get("skipLlm") === "true";
    const kind = String(form.get("kind") || "text");

    if (!voiceId) {
      return NextResponse.json({ error: "voiceId is required" }, { status: 400 });
    }

    // ---- 1. Extract raw text ----
    let raw: string;
    if (kind === "pdf") {
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "PDF file is required" }, { status: 400 });
      const buf = await file.arrayBuffer();
      raw = await extractPdfText(buf);
    } else {
      raw = String(form.get("text") || "");
    }
    if (!raw.trim()) {
      return NextResponse.json({ error: "No text to read" }, { status: 400 });
    }

    // ---- 2. Regex cleanup (fast pass 1) ----
    const cleaned = cleanText(raw);

    // ---- 3. Chunk into TTS-sized segments ----
    const chunks = chunkText(cleaned);
    if (chunks.length === 0) {
      return NextResponse.json({ error: "Cleanup left no text to read" }, { status: 400 });
    }

    // ---- 4. LLM rewrite pass (semantic cleanup + self-recursive refinement) ----
    const rewritten = skipLlm ? chunks : await rewriteChunks(chunks);

    // Re-chunk the LLM output in case sentences got restructured
    const finalChunks = skipLlm ? chunks : chunkText(rewritten.join("\n\n"));

    // ---- 5. Generate audio chunk-by-chunk with voice continuity ----
    const audio = await generateFullAudio({
      chunks: finalChunks,
      voiceId,
      modelId,
    });

    const filename = `paper-${Date.now()}.mp3`;
    return new Response(audio as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(audio.byteLength),
        "X-Chunks": String(finalChunks.length),
        "X-Char-Count": String(cleaned.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/generate] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
