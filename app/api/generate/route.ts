/**
 * POST /api/generate
 *
 * Multipart form:
 *   - provider:  "elevenlabs" | "openai"  (default: "openai")
 *   - voiceId:   string
 *   - modelId:   string (provider-specific)
 *   - llmMode:   "narration" | "condensed"  (default: "narration")
 *   - skipLlm:   "true" | "false" (optional — skip LLM rewrite entirely)
 *   - kind:      "text" | "pdf"
 *   - text:      string (when kind=text)
 *   - file:      File (when kind=pdf)
 *
 * Returns: audio/mpeg stream (the generated MP3)
 */

import { NextRequest, NextResponse } from "next/server";
import { cleanText } from "@/lib/clean";
import { chunkText } from "@/lib/chunk";
import { rewriteChunks, type RewriteMode } from "@/lib/llm";
import { generateFullAudio } from "@/lib/tts";
import { generateOpenAiFullAudio } from "@/lib/tts-openai";
import { extractPdfText } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const provider = String(form.get("provider") || "openai") as
      | "elevenlabs"
      | "openai";
    const voiceId = String(form.get("voiceId") || "");
    const modelId = String(
      form.get("modelId") ||
        (provider === "openai" ? "tts-1" : "eleven_flash_v2_5"),
    );
    const llmMode = (String(form.get("llmMode") || "narration") as RewriteMode);
    const skipLlm = form.get("skipLlm") === "true";
    const kind = String(form.get("kind") || "text");

    if (!voiceId) {
      return NextResponse.json({ error: "voiceId is required" }, { status: 400 });
    }
    if (provider !== "elevenlabs" && provider !== "openai") {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}` },
        { status: 400 },
      );
    }
    if (llmMode !== "narration" && llmMode !== "condensed") {
      return NextResponse.json(
        { error: `Unknown llmMode: ${llmMode}` },
        { status: 400 },
      );
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

    // ---- 2. Regex cleanup ----
    const cleaned = cleanText(raw);

    // ---- 3. Chunk into TTS-sized segments ----
    const chunks = chunkText(cleaned);
    if (chunks.length === 0) {
      return NextResponse.json({ error: "Cleanup left no text to read" }, { status: 400 });
    }

    // ---- 4. LLM rewrite (narration or condensed) ----
    const rewritten = skipLlm ? chunks : await rewriteChunks(chunks, llmMode);

    // Re-chunk the LLM output in case sentences got restructured
    const finalChunks = skipLlm
      ? chunks
      : chunkText(rewritten.join("\n\n"));

    // ---- 5. TTS via the selected provider ----
    const finalCharCount = finalChunks.reduce((s, c) => s + c.length, 0);
    let audio: Uint8Array;
    if (provider === "openai") {
      audio = await generateOpenAiFullAudio({
        chunks: finalChunks,
        voiceId,
        modelId,
      });
    } else {
      audio = await generateFullAudio({
        chunks: finalChunks,
        voiceId,
        modelId,
      });
    }

    const filename = `paper-${Date.now()}.mp3`;
    return new Response(audio as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(audio.byteLength),
        "X-Chunks": String(finalChunks.length),
        "X-Char-Count": String(finalCharCount),
        "X-Raw-Char-Count": String(cleaned.length),
        "X-Provider": provider,
        "X-Llm-Mode": llmMode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/generate] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
