/**
 * ElevenLabs TTS client tuned for research paper narration.
 *
 * Key decisions:
 *
 * 1. **Audiobook-tuned voice settings.** Long-form narration wants moderate
 *    stability (0.55) for natural variation without robotic-ness, high
 *    similarity_boost (0.75) for voice consistency, and low style (0.15)
 *    because aggressive style drift is fatiguing over 20+ minutes.
 *
 * 2. **Voice continuity across chunks.** ElevenLabs' `previous_request_ids`
 *    parameter stitches consecutive TTS calls together so the voice doesn't
 *    reset between chunks. We pass the most recent 3 request IDs (the API
 *    limit) with each call.
 *
 * 3. **Model choice.** `eleven_multilingual_v2` gives the best long-form
 *    narration quality. For faster generation we can switch to
 *    `eleven_turbo_v2_5` — half the latency, slight quality tradeoff.
 *
 * 4. **MP3 concatenation.** ElevenLabs returns MP3 frames; concatenating the
 *    raw bytes of multiple MP3 responses at the same bitrate produces a
 *    valid playable file. No ffmpeg dependency needed.
 */

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export type VoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

export const AUDIOBOOK_SETTINGS: VoiceSettings = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0.15,
  use_speaker_boost: true,
};

export type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

/**
 * Fetch the user's available voices from ElevenLabs.
 */
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { "xi-api-key": getApiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs /voices failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.voices as ElevenLabsVoice[];
}

/**
 * Generate speech for a single chunk. Returns the raw MP3 buffer and the
 * request ID (needed for continuity chaining with the next chunk).
 */
export async function generateChunk(params: {
  text: string;
  voiceId: string;
  modelId: string;
  previousRequestIds?: string[];
  settings?: VoiceSettings;
}): Promise<{ audio: ArrayBuffer; requestId: string | null }> {
  const { text, voiceId, modelId, previousRequestIds = [], settings = AUDIOBOOK_SETTINGS } = params;

  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings: settings,
  };

  // API accepts up to 3 previous request IDs for voice continuity
  if (previousRequestIds.length > 0) {
    body.previous_request_ids = previousRequestIds.slice(-3);
  }

  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": getApiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${errText}`);
  }

  const requestId = res.headers.get("request-id");
  const audio = await res.arrayBuffer();
  return { audio, requestId };
}

/**
 * Generate speech for all chunks sequentially, chaining request IDs for
 * voice continuity. Returns a single concatenated MP3 buffer.
 *
 * We do this sequentially (not in parallel) because `previous_request_ids`
 * must reference *actual* prior request IDs that exist server-side.
 */
export async function generateFullAudio(params: {
  chunks: string[];
  voiceId: string;
  modelId: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<Uint8Array> {
  const { chunks, voiceId, modelId, onProgress } = params;

  const audioBuffers: Uint8Array[] = [];
  const requestIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const { audio, requestId } = await generateChunk({
      text: chunks[i],
      voiceId,
      modelId,
      previousRequestIds: requestIds,
    });
    audioBuffers.push(new Uint8Array(audio));
    if (requestId) requestIds.push(requestId);
    onProgress?.(i + 1, chunks.length);
  }

  // Concatenate MP3 buffers. MP3 is a stream-of-frames format and concatenating
  // multiple valid MP3 byte streams at the same bitrate yields a playable file.
  const totalLength = audioBuffers.reduce((s, b) => s + b.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of audioBuffers) {
    combined.set(buf, offset);
    offset += buf.length;
  }
  return combined;
}
