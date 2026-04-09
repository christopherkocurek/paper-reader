/**
 * OpenAI TTS client.
 *
 * OpenAI's TTS API (`/v1/audio/speech`) is dramatically cheaper than
 * ElevenLabs for bulk narration work — $15/1M chars on tts-1 vs
 * ~$200/1M effective rate on ElevenLabs subscriptions — with good enough
 * quality for academic content.
 *
 * Key differences from the ElevenLabs client:
 *   - Voices are a fixed set of 6 hardcoded strings, not fetched from an API
 *   - No voice continuity mechanism (previous_request_ids), but OpenAI TTS
 *     is deterministic per (voice, text) so consecutive chunks sound
 *     consistent without any chaining
 *   - Chunks can be processed in parallel (we pick concurrency=4 to stay
 *     under rate limits while still being fast)
 *   - Hard per-request character limit of 4096
 */

const OPENAI_BASE = "https://api.openai.com/v1";

export const OPENAI_VOICES = [
  {
    id: "onyx",
    name: "Onyx",
    description: "deep · authoritative · male — research narration default",
    narrationRecommended: true,
  },
  {
    id: "echo",
    name: "Echo",
    description: "calm · clear · male — long-form friendly",
    narrationRecommended: true,
  },
  {
    id: "fable",
    name: "Fable",
    description: "warm · british · male — storyteller, engaging",
    narrationRecommended: true,
  },
  {
    id: "alloy",
    name: "Alloy",
    description: "neutral · balanced · androgynous — safe default",
    narrationRecommended: false,
  },
  {
    id: "nova",
    name: "Nova",
    description: "bright · energetic · female",
    narrationRecommended: false,
  },
  {
    id: "shimmer",
    name: "Shimmer",
    description: "soft · soothing · female",
    narrationRecommended: false,
  },
] as const;

export const OPENAI_MODELS = [
  {
    id: "tts-1",
    label: "tts-1 :: $15/1M chars, fast",
    costPer1M: 15,
  },
  {
    id: "tts-1-hd",
    label: "tts-1-hd :: $30/1M chars, higher quality",
    costPer1M: 30,
  },
] as const;

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

/**
 * Generate speech for a single chunk via OpenAI TTS.
 * Returns the raw MP3 buffer.
 */
export async function generateOpenAiChunk(params: {
  text: string;
  voiceId: string;
  modelId: string;
}): Promise<ArrayBuffer> {
  const { text, voiceId, modelId } = params;

  const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      model: modelId,
      input: text,
      voice: voiceId,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI TTS failed: ${res.status} ${errText}`);
  }

  return res.arrayBuffer();
}

/**
 * Generate speech for all chunks. Runs with bounded parallelism (4 at a time)
 * then concatenates the MP3 buffers into a single playable file.
 */
export async function generateOpenAiFullAudio(params: {
  chunks: string[];
  voiceId: string;
  modelId: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<Uint8Array> {
  const { chunks, voiceId, modelId, onProgress } = params;
  const CONCURRENCY = 4;

  const results: Uint8Array[] = new Array(chunks.length);
  let done = 0;

  // Process in batches of CONCURRENCY to stay under rate limits
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((text) => generateOpenAiChunk({ text, voiceId, modelId }))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = new Uint8Array(batchResults[j]);
      done++;
      onProgress?.(done, chunks.length);
    }
  }

  // Concat MP3 buffers (valid for same encoding output)
  const totalLength = results.reduce((s, b) => s + b.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of results) {
    combined.set(buf, offset);
    offset += buf.length;
  }
  return combined;
}

/**
 * Generate a short preview sample for a voice so users can A/B them in the UI.
 * Uses a fixed sentence that's representative of academic narration tone.
 */
const PREVIEW_TEXT =
  "Research papers come alive when narration is clear and measured, letting ideas breathe.";

export async function generateVoicePreview(params: {
  voiceId: string;
  modelId?: string;
}): Promise<Uint8Array> {
  const audio = await generateOpenAiChunk({
    text: PREVIEW_TEXT,
    voiceId: params.voiceId,
    modelId: params.modelId ?? "tts-1",
  });
  return new Uint8Array(audio);
}
