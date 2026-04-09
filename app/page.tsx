"use client";

/**
 * PAPER_READER :: cypherpunk ascii-core interface
 *
 * Three input modes, terminal aesthetic, phosphor-green CRT vibe.
 * Same pipeline as before — this file is a visual rewrite only.
 */

import { useEffect, useState, useRef, type ReactNode } from "react";

type ElVoice = {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  is_owner: boolean;
};

type OpenAiVoice = {
  id: string;
  name: string;
  description: string;
  narrationRecommended: boolean;
};

type OpenAiModel = {
  id: string;
  label: string;
  costPer1M: number;
};

type Mode = "paste" | "txt" | "pdf";
type Provider = "elevenlabs" | "openai";
type LlmMode = "narration" | "condensed";

const ELEVENLABS_MODELS = [
  {
    id: "eleven_flash_v2_5",
    label: "eleven_flash_v2_5  ::  0.5x credit cost ⚡",
    creditMultiplier: 0.5,
  },
  {
    id: "eleven_turbo_v2_5",
    label: "eleven_turbo_v2_5  ::  1.0x credit cost",
    creditMultiplier: 1.0,
  },
  {
    id: "eleven_multilingual_v2",
    label: "eleven_multilingual_v2  ::  1.0x credit cost, max fidelity",
    creditMultiplier: 1.0,
  },
  {
    id: "eleven_v3",
    label: "eleven_v3  ::  experimental",
    creditMultiplier: 1.0,
  },
];

const NARRATION_VOICES = new Set([
  "Brian", "Adam", "Rachel", "George", "Daniel", "Antoni", "Sarah", "Charlotte", "Matilda",
]);

// LLM compression ratios (used for cost estimation)
const COMPRESSION = {
  none: 1.0,
  narration: 0.65,
  condensed: 0.30,
};

// ───── utilities ─────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function hexId(): string {
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 16).toString(16).toUpperCase(),
  ).join("");
}

function fmtClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ───── primitives ────────────────────────────────────────────────────

function Panel({
  title,
  meta,
  children,
  tone = "default",
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  tone?: "default" | "alert" | "busy";
}) {
  const borderClass =
    tone === "alert"
      ? "border-[var(--alert)]/60"
      : tone === "busy"
        ? "border-[var(--phosphor)]/50"
        : "border-[var(--border-bright)]";
  const titleClass =
    tone === "alert" ? "alert" : tone === "busy" ? "phosphor" : "phosphor-soft";

  return (
    <section className={`relative border ${borderClass} bg-[var(--bg-panel)]`}>
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-[11px] uppercase tracking-[0.15em]">
        <span className="text-[var(--fg-ghost)]">┌─</span>
        <span className={titleClass}>{title}</span>
        <span className="flex-1 truncate text-[var(--fg-ghost)]">
          ─────────────────────────────────────────────────────────
        </span>
        {meta && <span className="text-[var(--fg-dim)]">{meta}</span>}
        <span className="text-[var(--fg-ghost)]">─┐</span>
      </header>
      <div className="relative px-4 py-4">{children}</div>
      <footer className="flex items-center border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--fg-ghost)]">
        <span>└─</span>
        <span className="flex-1 truncate">
          ─────────────────────────────────────────────────────────────────────
        </span>
        <span>─┘</span>
      </footer>
    </section>
  );
}

function StatusDot({ state }: { state: "idle" | "busy" | "ready" | "err" }) {
  const color =
    state === "err"
      ? "var(--alert)"
      : state === "busy"
        ? "var(--amber)"
        : state === "ready"
          ? "var(--phosphor)"
          : "var(--fg-mute)";
  return (
    <span
      className="flicker inline-block"
      style={{
        width: 8,
        height: 8,
        background: color,
        boxShadow: `0 0 6px ${color}, 0 0 12px ${color}`,
      }}
    />
  );
}

// ───── top status bar ────────────────────────────────────────────────

function StatusBar({
  sessionId,
  state,
  charCount,
  quotaRemaining,
  quotaLimit,
  quotaTier,
}: {
  sessionId: string;
  state: "idle" | "busy" | "ready" | "err";
  charCount: number;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  quotaTier: string | null;
}) {
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stateLabel =
    state === "busy" ? "BUSY" : state === "ready" ? "READY" : state === "err" ? "ERROR" : "IDLE";
  const stateClass =
    state === "err" ? "alert" : state === "busy" ? "amber-glow" : state === "ready" ? "phosphor" : "text-[var(--fg-dim)]";

  const quotaClass =
    quotaRemaining === null
      ? "text-[var(--fg-mute)]"
      : quotaRemaining < 2000
        ? "alert"
        : quotaRemaining < 8000
          ? "amber-glow"
          : "phosphor-soft";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-[var(--border-bright)] bg-[var(--bg-panel)] px-3 py-1.5 text-[11px] uppercase tracking-wider">
      <span className="flex items-center gap-1.5">
        <StatusDot state={state} />
        <span className={stateClass}>[ {stateLabel} ]</span>
      </span>
      <span className="text-[var(--fg-dim)]">
        SESSION :: <span className="phosphor-soft">0x{sessionId}</span>
      </span>
      <span className="text-[var(--fg-dim)]">
        UPTIME :: <span className="phosphor-soft">{fmtClock(uptime)}</span>
      </span>
      <span className="text-[var(--fg-dim)]">
        BUFFER :: <span className="phosphor-soft">{fmtBytes(charCount)}</span>
      </span>
      {quotaRemaining !== null && quotaLimit !== null && (
        <span className="text-[var(--fg-dim)]">
          TTS_QUOTA ::{" "}
          <span className={quotaClass}>
            {quotaRemaining.toLocaleString()} / {quotaLimit.toLocaleString()}
          </span>
          {quotaTier && (
            <span className="text-[var(--fg-mute)]"> [{quotaTier}]</span>
          )}
        </span>
      )}
      <span className="ml-auto text-[var(--fg-ghost)]">
        paper_reader/v0.1.0
      </span>
    </div>
  );
}

// ───── input tabs ────────────────────────────────────────────────────

function ModeTabs({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const tabs: { id: Mode; label: string }[] = [
    { id: "paste", label: "PASTE_TEXT" },
    { id: "txt", label: "LOAD_TXT" },
    { id: "pdf", label: "LOAD_PDF" },
  ];
  return (
    <div className="flex flex-wrap gap-1 text-[12px] uppercase tracking-wider">
      {tabs.map((t) => {
        const active = mode === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={`px-3 py-1.5 transition-colors ${
              active
                ? "phosphor"
                : "text-[var(--fg-dim)] hover:text-[var(--fg)]"
            }`}
          >
            {active ? `>[ ${t.label} ]<` : `[ ${t.label} ]`}
          </button>
        );
      })}
    </div>
  );
}

// ───── pipeline stages (fake progress during generation) ─────────────

const PIPELINE_STAGES_LLM = [
  "INIT            :: spawn worker",
  "EXTRACT         :: parse source document",
  "SANITIZE        :: strip citations + latex + urls",
  "LLM_REWRITE     :: claude rewrites for narration",
  "REFINE_LOOP     :: self-recursive quality check",
  "CHUNK           :: split at sentence boundaries",
  "ELEVENLABS_TTS  :: generate audio stream",
  "CHAIN_CONTINUITY:: previous_request_ids",
  "CONCAT          :: merge mp3 frames",
  "ENCODE          :: finalize output",
];
const PIPELINE_STAGES_NOLLM = [
  "INIT            :: spawn worker",
  "EXTRACT         :: parse source document",
  "SANITIZE        :: strip citations + latex + urls",
  "CHUNK           :: split at sentence boundaries",
  "ELEVENLABS_TTS  :: generate audio stream",
  "CHAIN_CONTINUITY:: previous_request_ids",
  "CONCAT          :: merge mp3 frames",
  "ENCODE          :: finalize output",
];

function PipelineDisplay({
  running,
  useLlm,
}: {
  running: boolean;
  useLlm: boolean;
}) {
  const stages = useLlm ? PIPELINE_STAGES_LLM : PIPELINE_STAGES_NOLLM;
  const [activeIdx, setActiveIdx] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!running) {
      setActiveIdx(0);
      return;
    }
    const id = setInterval(() => {
      setActiveIdx((i) => Math.min(i + 1, stages.length - 1));
      setTick((t) => t + 1);
    }, 1800);
    return () => clearInterval(id);
  }, [running, stages.length]);

  // progress bar fills as we advance stages
  const progress = running
    ? Math.min(0.95, (activeIdx + 1) / stages.length)
    : 0;
  const filled = Math.floor(progress * 28);
  const bar = "▓".repeat(filled) + "░".repeat(28 - filled);

  return (
    <div className="space-y-2 font-mono text-[11px] leading-relaxed">
      {stages.map((s, i) => {
        const isActive = running && i === activeIdx;
        const isDone = running && i < activeIdx;
        const isPending = !running || i > activeIdx;
        return (
          <div
            key={s}
            className={`flex items-center gap-2 ${
              isDone
                ? "phosphor-dim"
                : isActive
                  ? "phosphor"
                  : isPending
                    ? "text-[var(--fg-ghost)]"
                    : "text-[var(--fg-dim)]"
            }`}
          >
            <span className="w-6">
              {isDone ? "[OK]" : isActive ? "[..]" : "[  ]"}
            </span>
            <span className="flex-1">
              {s}
              {isActive && <span className="blink"> █</span>}
            </span>
          </div>
        );
      })}
      <div className="mt-4 flex items-center gap-2 text-[11px]">
        <span className="text-[var(--fg-dim)]">PROGRESS</span>
        <span className={running ? "phosphor" : "text-[var(--fg-ghost)]"}>
          [{bar}]
        </span>
        <span className={running ? "phosphor-soft" : "text-[var(--fg-ghost)]"}>
          {Math.floor(progress * 100).toString().padStart(3, " ")}%
        </span>
      </div>
      {running && (
        <div className="mt-1 text-[10px] text-[var(--fg-mute)]">
          elapsed :: {(tick * 1.8).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

// ───── main component ────────────────────────────────────────────────

export default function Home() {
  const [sessionId] = useState(() => hexId());

  const [mode, setMode] = useState<Mode>("paste");
  const [pasteText, setPasteText] = useState("");
  const [txtFile, setTxtFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Backend provider (cheapest default: OpenAI)
  const [provider, setProvider] = useState<Provider>("openai");
  const [llmMode, setLlmMode] = useState<LlmMode>("narration");

  // ElevenLabs voices
  const [usableVoices, setUsableVoices] = useState<ElVoice[]>([]);
  const [lockedVoices, setLockedVoices] = useState<ElVoice[]>([]);
  const [elAvailable, setElAvailable] = useState(true);

  // OpenAI voices + models
  const [openaiVoices, setOpenaiVoices] = useState<OpenAiVoice[]>([]);
  const [openaiModels, setOpenaiModels] = useState<OpenAiModel[]>([]);
  const [openaiAvailable, setOpenaiAvailable] = useState(false);

  // Selected voice + model — resets when provider changes
  const [voiceId, setVoiceId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("tts-1");
  const [useLlmRewrite, setUseLlmRewrite] = useState(true);

  // Voice preview
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);

  // ElevenLabs quota (from /api/quota, populated only for that provider)
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [quotaLimit, setQuotaLimit] = useState<number | null>(null);
  const [quotaTier, setQuotaTier] = useState<string | null>(null);
  const [quotaResetUnix, setQuotaResetUnix] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioSize, setAudioSize] = useState<number>(0);
  const [audioFilename, setAudioFilename] = useState<string>("paper.mp3");
  const [audioFileId] = useState(() => hexId());
  const lastObjectUrlRef = useRef<string | null>(null);

  // Fetch quota on mount (best-effort — silently skipped if key lacks user_read)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/quota");
        const data = await res.json();
        if (data.ok) {
          setQuotaRemaining(data.charRemaining);
          setQuotaLimit(data.charLimit);
          setQuotaTier(data.tier);
          setQuotaResetUnix(data.nextResetUnix);
        }
      } catch {
        /* ignore — quota display is optional */
      }
    })();
  }, []);

  // Fetch voices for both providers on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/voices");
        if (!res.ok)
          throw new Error(
            (await res.json()).error ?? "VOICE_REGISTRY_FETCH_FAILED",
          );
        const data = await res.json();

        // ElevenLabs
        const el = data.elevenlabs ?? { ok: false };
        setElAvailable(el.ok === true);
        const usable = (el.usable ?? []) as ElVoice[];
        const locked = (el.locked ?? []) as ElVoice[];
        const sortFn = (a: ElVoice, b: ElVoice) => {
          const sA = NARRATION_VOICES.has(a.name.split(" ")[0]) ? 0 : 1;
          const sB = NARRATION_VOICES.has(b.name.split(" ")[0]) ? 0 : 1;
          if (sA !== sB) return sA - sB;
          return a.name.localeCompare(b.name);
        };
        usable.sort(sortFn);
        locked.sort(sortFn);
        setUsableVoices(usable);
        setLockedVoices(locked);

        // OpenAI
        const oa = data.openai ?? {};
        setOpenaiVoices(oa.voices ?? []);
        setOpenaiModels(oa.models ?? []);
        setOpenaiAvailable(oa.ok === true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "UNKNOWN_ERROR");
      } finally {
        setLoadingVoices(false);
      }
    })();
    return () => {
      if (lastObjectUrlRef.current) URL.revokeObjectURL(lastObjectUrlRef.current);
      if (previewAudio) previewAudio.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When provider changes, reset voice + model to sensible defaults
  useEffect(() => {
    if (loadingVoices) return;
    if (provider === "openai") {
      const recommended = openaiVoices.find((v) => v.narrationRecommended);
      setVoiceId((recommended ?? openaiVoices[0])?.id ?? "");
      setModelId("tts-1");
    } else {
      if (usableVoices.length > 0) {
        const brian = usableVoices.find((v) => v.name.startsWith("Brian"));
        const firstNarr = usableVoices.find((v) =>
          NARRATION_VOICES.has(v.name.split(" ")[0]),
        );
        setVoiceId((brian ?? firstNarr ?? usableVoices[0]).voice_id);
      } else {
        setVoiceId("");
      }
      setModelId("eleven_flash_v2_5");
    }
  }, [provider, loadingVoices, openaiVoices, usableVoices]);

  // Preview a voice — generates a short audio sample and plays it
  async function handlePreview() {
    if (!voiceId || previewLoading) return;
    setPreviewLoading(true);
    if (previewAudio) previewAudio.pause();
    try {
      const res = await fetch("/api/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, voiceId, modelId }),
      });
      if (!res.ok) throw new Error("preview failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      setPreviewAudio(audio);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    } catch (e) {
      console.error("preview error", e);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioSize(0);

    try {
      const form = new FormData();
      form.set("provider", provider);
      form.set("voiceId", voiceId);
      form.set("modelId", modelId);
      form.set("llmMode", llmMode);
      form.set("skipLlm", useLlmRewrite ? "false" : "true");

      if (mode === "pdf") {
        if (!pdfFile) throw new Error("NO_PDF_SELECTED");
        form.set("kind", "pdf");
        form.set("file", pdfFile);
      } else if (mode === "txt") {
        if (!txtFile) throw new Error("NO_TXT_SELECTED");
        const text = await txtFile.text();
        form.set("kind", "text");
        form.set("text", text);
      } else {
        if (!pasteText.trim()) throw new Error("EMPTY_BUFFER");
        form.set("kind", "text");
        form.set("text", pasteText);
      }

      const res = await fetch("/api/generate", { method: "POST", body: form });
      if (!res.ok) {
        let msg = `TRANSMIT_FAILED :: ${res.status}`;
        try {
          const j = await res.json();
          if (j.error) msg = j.error;
        } catch {
          /* non-json */
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      lastObjectUrlRef.current = url;
      setAudioUrl(url);
      setAudioSize(blob.size);

      const disp = res.headers.get("content-disposition") || "";
      const match = disp.match(/filename="([^"]+)"/);
      if (match) setAudioFilename(match[1]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "UNKNOWN_ERROR";
      setError(msg);
      // Parse ElevenLabs quota errors so we can show remaining credits in the UI
      const quotaMatch = msg.match(/You have (\d+) credits remaining/i);
      if (quotaMatch) setQuotaRemaining(parseInt(quotaMatch[1], 10));
    } finally {
      setLoading(false);
    }
  }

  const bufferChars =
    mode === "paste"
      ? pasteText.length
      : mode === "txt"
        ? txtFile?.size ?? 0
        : pdfFile?.size ?? 0;

  // Cost estimator for both providers. The pipeline goes:
  //   raw input → clean → LLM rewrite (narration 0.65x or condensed 0.30x)
  //   → TTS provider charges per final character.
  const compressionRatio = !useLlmRewrite
    ? COMPRESSION.none
    : llmMode === "condensed"
      ? COMPRESSION.condensed
      : COMPRESSION.narration;
  const estimatedFinalChars = Math.round(bufferChars * compressionRatio);

  // ElevenLabs estimate (credits)
  const elModel =
    ELEVENLABS_MODELS.find((m) => m.id === modelId) ?? ELEVENLABS_MODELS[0];
  const estimatedCredits = Math.round(
    estimatedFinalChars * elModel.creditMultiplier,
  );

  // OpenAI estimate (dollars)
  const openaiModel = openaiModels.find((m) => m.id === modelId) ?? openaiModels[0];
  const estimatedUsd = openaiModel
    ? (estimatedFinalChars * openaiModel.costPer1M) / 1_000_000
    : 0;

  const willExceedQuota =
    provider === "elevenlabs" &&
    quotaRemaining !== null &&
    estimatedCredits > quotaRemaining;

  const state: "idle" | "busy" | "ready" | "err" = error
    ? "err"
    : loading
      ? "busy"
      : audioUrl
        ? "ready"
        : "idle";

  const noUsableElVoices = !loadingVoices && usableVoices.length === 0;
  const selectedVoiceLocked =
    provider === "elevenlabs" &&
    lockedVoices.some((v) => v.voice_id === voiceId);
  const blockedByElNoVoices = provider === "elevenlabs" && noUsableElVoices;

  const canGenerate =
    !loading &&
    !!voiceId &&
    !blockedByElNoVoices &&
    !selectedVoiceLocked &&
    !willExceedQuota &&
    (mode === "paste"
      ? pasteText.trim().length > 0
      : mode === "txt"
        ? !!txtFile
        : !!pdfFile);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* ═══ TOP STATUS BAR ═══ */}
      <StatusBar
        sessionId={sessionId}
        state={state}
        charCount={bufferChars}
        quotaRemaining={quotaRemaining}
        quotaLimit={quotaLimit}
        quotaTier={quotaTier}
      />

      {/* ═══ HEADER / BANNER ═══ */}
      <header className="mt-6 mb-6">
        {/* top rule */}
        <div className="text-[var(--fg-ghost)] text-[10px] leading-none tracking-[-0.05em] overflow-hidden whitespace-nowrap">
          ══════════════════════════════════════════════════════════════════════════════════════════════════
        </div>

        {/* main title */}
        <div className="flex items-baseline gap-2 py-4 sm:gap-3">
          <span
            aria-hidden
            className="phosphor font-bold leading-none text-[28px] sm:text-[40px]"
          >
            {">"}_
          </span>
          <h1 className="phosphor font-black leading-none tracking-[0.08em] text-[32px] sm:text-[56px]">
            PAPER_READER
          </h1>
          <span
            aria-hidden
            className="phosphor blink font-black leading-none text-[32px] sm:text-[56px]"
          >
            █
          </span>
        </div>

        {/* subtitle row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.3em] text-[var(--fg-dim)] sm:text-[11px]">
          <span className="text-[var(--fg-ghost)]">::</span>
          <span className="phosphor-dim">tts_pipeline</span>
          <span className="text-[var(--fg-ghost)]">//</span>
          <span>cypher_core</span>
          <span className="text-[var(--fg-ghost)]">//</span>
          <span>v0.1.0</span>
          <span className="text-[var(--fg-ghost)]">//</span>
          <span className="info-glow">[ online ]</span>
        </div>

        {/* bottom rule */}
        <div className="mt-4 text-[var(--fg-ghost)] text-[10px] leading-none tracking-[-0.05em] overflow-hidden whitespace-nowrap">
          ══════════════════════════════════════════════════════════════════════════════════════════════════
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--fg-dim)]">
          {">"} transform academic documents into narration-grade audio.
          <br />
          {">"} cleans citations, latex, figure refs :: expands acronyms ::
          rewrites for speech :: chains voice continuity across chunks.
          <br />
          {">"} pipeline :: extract → sanitize → llm_rewrite → chunk → elevenlabs → concat
        </p>
      </header>

      {/* ═══ QUOTA BANNER (only relevant when provider=elevenlabs) ═══ */}
      {quotaRemaining !== null && provider === "elevenlabs" && (
        <div
          className={`mb-4 border p-3 text-[11px] ${
            willExceedQuota
              ? "border-[var(--alert)]/60"
              : "border-[var(--border-bright)]"
          } bg-[var(--bg-panel)]`}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 uppercase tracking-wider">
            <span className={willExceedQuota ? "alert" : "phosphor-soft"}>
              [QUOTA]
            </span>
            <span className="text-[var(--fg-dim)]">
              remaining ::{" "}
              <span className={willExceedQuota ? "alert" : "phosphor"}>
                {quotaRemaining.toLocaleString()}
              </span>{" "}
              credits
            </span>
            <span className="text-[var(--fg-dim)]">
              this request ::{" "}
              <span className={willExceedQuota ? "alert" : "phosphor-soft"}>
                ≈{estimatedCredits.toLocaleString()}
              </span>{" "}
              credits
            </span>
            {willExceedQuota && (
              <span className="alert">
                :: will exceed by {(estimatedCredits - quotaRemaining).toLocaleString()}
              </span>
            )}
          </div>
          <div className="mt-2 text-[10px] text-[var(--fg-dim)]">
            {">"} llm rewrite compresses input ~35% :: flash v2.5 model costs
            0.5x per char :: combined, you get ~3x more audio per credit vs
            raw-paste with multilingual v2
          </div>
          {quotaResetUnix && (
            <div className="mt-1 text-[10px] text-[var(--fg-dim)]">
              {">"} quota resets ::{" "}
              <span className="phosphor-soft">
                {new Date(quotaResetUnix * 1000).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ═══ NO USABLE VOICES BANNER (only when provider=elevenlabs) ═══ */}
      {blockedByElNoVoices && (
        <div className="mb-4 border border-[var(--amber)]/60 bg-[var(--bg-panel)] p-4 text-[11px] leading-relaxed">
          <div className="mb-2 flex items-center gap-2">
            <StatusDot state="busy" />
            <span className="amber-glow uppercase tracking-[0.2em]">
              [ ATTN ] :: NO USABLE VOICES ON THIS ACCOUNT
            </span>
          </div>
          <div className="space-y-2 text-[var(--fg-dim)]">
            <div>
              {">"} your elevenlabs api key is on the{" "}
              <span className="amber-glow">free tier</span>. free tier can only
              use voices you own ({lockedVoices.length}{" "}
              library voices are visible but{" "}
              <span className="alert">locked</span> for api usage).
            </div>
            <div className="mt-3 space-y-1">
              <div className="phosphor-soft uppercase tracking-[0.2em] text-[10px]">
                &gt;&gt; options to unlock:
              </div>
              <div>
                <span className="phosphor">[A]</span> clone a voice (free, 2 min){" "}
                ::{" "}
                <a
                  href="https://elevenlabs.io/app/voice-lab"
                  target="_blank"
                  rel="noreferrer"
                  className="phosphor-soft underline hover:phosphor"
                >
                  elevenlabs.io/app/voice-lab
                </a>
                {" "}— upload 60s of audio, it becomes yours, works immediately with your current key
              </div>
              <div>
                <span className="phosphor">[B]</span> upgrade to starter ($5/mo){" "}
                ::{" "}
                <a
                  href="https://elevenlabs.io/app/subscription"
                  target="_blank"
                  rel="noreferrer"
                  className="phosphor-soft underline hover:phosphor"
                >
                  elevenlabs.io/app/subscription
                </a>
                {" "}— unlocks api access to all {lockedVoices.length} library voices immediately
              </div>
              <div>
                <span className="phosphor">[C]</span> ask claude to add openai tts
                as a second backend (no voice restrictions, ~$15/1M chars)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ INPUT SOURCE ═══ */}
      <Panel
        title="INPUT_SOURCE"
        meta={
          <span>
            {mode.toUpperCase()} :: {fmtBytes(bufferChars)}
          </span>
        }
      >
        <ModeTabs mode={mode} setMode={setMode} />

        <div className="mt-4">
          {mode === "paste" && (
            <div className="relative border border-[var(--border-bright)] bg-[var(--bg)]">
              <div className="flex items-center border-b border-[var(--border)] px-3 py-1 text-[10px] text-[var(--fg-dim)]">
                <span className="phosphor-soft">$</span>
                <span className="ml-2">stdin &lt;&lt; paste_buffer</span>
                <span className="ml-auto text-[var(--fg-mute)]">
                  {pasteText.length.toLocaleString()} CHARS ::{" "}
                  {pasteText.split(/\s+/).filter(Boolean).length.toLocaleString()} TOKENS
                </span>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="> paste research paper, abstract, notes, or any text to narrate_"
                className="h-72 w-full bg-transparent p-3 text-[13px] leading-relaxed"
              />
            </div>
          )}

          {mode === "txt" && (
            <label className="relative flex h-36 cursor-pointer flex-col items-center justify-center border border-dashed border-[var(--border-bright)] bg-[var(--bg)] px-4 text-center transition-colors hover:border-[var(--phosphor)] hover:bg-[var(--bg-elev)]">
              <input
                type="file"
                accept=".txt,text/plain"
                onChange={(e) => setTxtFile(e.target.files?.[0] ?? null)}
              />
              {txtFile ? (
                <>
                  <span className="phosphor text-xs">{">> LOADED <<"}</span>
                  <span className="mt-2 text-[12px] text-[var(--fg)]">
                    {txtFile.name}
                  </span>
                  <span className="mt-1 text-[10px] text-[var(--fg-dim)]">
                    {fmtBytes(txtFile.size)} :: click to change
                  </span>
                </>
              ) : (
                <>
                  <span className="phosphor-soft text-xs">
                    {"[ DROP .TXT FILE HERE ]"}
                  </span>
                  <span className="mt-2 text-[10px] text-[var(--fg-dim)]">
                    or click to select
                  </span>
                </>
              )}
            </label>
          )}

          {mode === "pdf" && (
            <label className="relative flex h-36 cursor-pointer flex-col items-center justify-center border border-dashed border-[var(--border-bright)] bg-[var(--bg)] px-4 text-center transition-colors hover:border-[var(--phosphor)] hover:bg-[var(--bg-elev)]">
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
              {pdfFile ? (
                <>
                  <span className="phosphor text-xs">{">> LOADED <<"}</span>
                  <span className="mt-2 text-[12px] text-[var(--fg)]">
                    {pdfFile.name}
                  </span>
                  <span className="mt-1 text-[10px] text-[var(--fg-dim)]">
                    {fmtBytes(pdfFile.size)} :: click to change
                  </span>
                </>
              ) : (
                <>
                  <span className="phosphor-soft text-xs">
                    {"[ DROP .PDF FILE HERE ]"}
                  </span>
                  <span className="mt-2 text-[10px] text-[var(--fg-dim)]">
                    or click to select
                  </span>
                </>
              )}
            </label>
          )}
        </div>
      </Panel>

      {/* ═══ CONFIG ═══ */}
      <div className="mt-4">
        <Panel
          title="CONFIG"
          meta={
            <span>
              {provider === "openai"
                ? `openai :: ${openaiVoices.length} voices`
                : `elevenlabs :: ${usableVoices.length} usable`}
            </span>
          }
        >
          {/* ── Backend provider toggle ── */}
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--fg-dim)]">
              {">>"} tts_backend
            </div>
            <div className="flex gap-1 text-[12px] uppercase tracking-wider">
              <button
                type="button"
                onClick={() => setProvider("openai")}
                disabled={!openaiAvailable}
                className={`px-4 py-2 transition-colors ${
                  provider === "openai"
                    ? "phosphor border border-[var(--phosphor)]/70 bg-[var(--bg)]"
                    : "border border-[var(--border)] text-[var(--fg-dim)] hover:border-[var(--border-hot)] hover:text-[var(--fg)]"
                } ${!openaiAvailable ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
              >
                {provider === "openai" ? ">[ OPENAI ]<" : "[ OPENAI ]"}
                <span className="ml-2 text-[9px] text-[var(--fg-dim)]">
                  pay-per-use
                </span>
              </button>
              <button
                type="button"
                onClick={() => setProvider("elevenlabs")}
                disabled={!elAvailable}
                className={`px-4 py-2 transition-colors ${
                  provider === "elevenlabs"
                    ? "phosphor border border-[var(--phosphor)]/70 bg-[var(--bg)]"
                    : "border border-[var(--border)] text-[var(--fg-dim)] hover:border-[var(--border-hot)] hover:text-[var(--fg)]"
                } ${!elAvailable ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
              >
                {provider === "elevenlabs" ? ">[ ELEVENLABS ]<" : "[ ELEVENLABS ]"}
                <span className="ml-2 text-[9px] text-[var(--fg-dim)]">
                  subscription
                </span>
              </button>
            </div>
          </div>

          {/* ── Voice + model selectors ── */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--fg-dim)]">
                <span>{">>"} voice_registry</span>
                {provider === "elevenlabs" && (
                  <span className="phosphor-dim">
                    {usableVoices.length} usable :: {lockedVoices.length} locked
                  </span>
                )}
                {provider === "openai" && (
                  <span className="phosphor-dim">
                    {openaiVoices.length} available
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  disabled={loadingVoices}
                  className="flex-1 text-[12px]"
                >
                  {loadingVoices && <option>{">> loading voices <<"}</option>}

                  {/* OpenAI voices */}
                  {provider === "openai" && openaiVoices.length > 0 && (
                    <>
                      <optgroup label="── recommended for narration ──">
                        {openaiVoices
                          .filter((v) => v.narrationRecommended)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              ★ {v.name} — {v.description}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="── other ──">
                        {openaiVoices
                          .filter((v) => !v.narrationRecommended)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} — {v.description}
                            </option>
                          ))}
                      </optgroup>
                    </>
                  )}

                  {/* ElevenLabs voices */}
                  {provider === "elevenlabs" && !loadingVoices && usableVoices.length === 0 && lockedVoices.length === 0 && (
                    <option>NO_VOICES_AVAILABLE</option>
                  )}
                  {provider === "elevenlabs" && !loadingVoices && usableVoices.length === 0 && lockedVoices.length > 0 && (
                    <option value="">-- no usable voices --</option>
                  )}
                  {provider === "elevenlabs" && usableVoices.length > 0 && (
                    <optgroup label="── usable ──">
                      {usableVoices.map((v) => {
                        const isNarration = NARRATION_VOICES.has(v.name.split(" ")[0]);
                        return (
                          <option key={v.voice_id} value={v.voice_id}>
                            {isNarration ? "★ " : "  "}
                            {v.name}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  {provider === "elevenlabs" && lockedVoices.length > 0 && (
                    <optgroup label="── locked (paid plan) ──">
                      {lockedVoices.map((v) => (
                        <option key={v.voice_id} value={v.voice_id}>
                          🔒 {v.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={!voiceId || previewLoading || loadingVoices}
                  title="preview this voice"
                  className={`border border-[var(--border-bright)] bg-[var(--bg)] px-3 text-[11px] uppercase tracking-wider transition-colors hover:border-[var(--phosphor)] hover:phosphor ${
                    previewLoading ? "phosphor blink" : "text-[var(--fg-dim)]"
                  } ${!voiceId || loadingVoices ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                >
                  {previewLoading ? "[ ... ]" : "[ ▶ preview ]"}
                </button>
              </div>
              {selectedVoiceLocked && (
                <div className="mt-1.5 text-[10px] alert">
                  [!] this voice requires a paid plan — pick a usable voice
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--fg-dim)]">
                {">>"} tts_model
              </div>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full text-[12px]"
              >
                {provider === "openai" &&
                  openaiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                {provider === "elevenlabs" &&
                  ELEVENLABS_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* ── LLM rewrite toggle + mode radio ── */}
          <div className="mt-4 border border-[var(--border)] bg-[var(--bg)] p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={useLlmRewrite}
                onChange={(e) => setUseLlmRewrite(e.target.checked)}
              />
              <div className="flex-1 text-[11px]">
                <div className="phosphor-soft uppercase tracking-wider">
                  LLM_REWRITE_PASS [recommended]
                </div>
                <div className="mt-1 text-[var(--fg-dim)]">
                  {">"} claude rewrites text for audio before tts ::
                  expands acronyms, replaces tables/algorithms/code with brief
                  descriptions, converts math to spoken words, drops affiliations
                  and references
                </div>
              </div>
            </label>

            {useLlmRewrite && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--fg-dim)]">
                  {">>"} rewrite_mode
                </div>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="llmMode"
                      value="narration"
                      checked={llmMode === "narration"}
                      onChange={() => setLlmMode("narration")}
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--phosphor)]"
                    />
                    <div className="flex-1 text-[11px]">
                      <span className={llmMode === "narration" ? "phosphor" : "text-[var(--fg-dim)]"}>
                        [ NARRATION ]
                      </span>{" "}
                      <span className="text-[var(--fg-dim)]">
                        ~65% of input length :: preserves full paper content,
                        every sentence rewritten for natural speech
                      </span>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="llmMode"
                      value="condensed"
                      checked={llmMode === "condensed"}
                      onChange={() => setLlmMode("condensed")}
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--phosphor)]"
                    />
                    <div className="flex-1 text-[11px]">
                      <span className={llmMode === "condensed" ? "phosphor" : "text-[var(--fg-dim)]"}>
                        [ CONDENSED ]
                      </span>{" "}
                      <span className="text-[var(--fg-dim)]">
                        ~30% of input length :: dedup across sections, drop
                        related work, compress methods, preserve findings +
                        limitations :: 3x cheaper per paper
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ── Cost estimator ── */}
          <div className="mt-4 border border-[var(--border)] bg-[var(--bg)] p-3 text-[11px]">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--fg-dim)]">
              {">>"} cost_estimate
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-[var(--fg-dim)]">
                raw buffer ::{" "}
                <span className="phosphor-soft">
                  {bufferChars.toLocaleString()} chars
                </span>
              </span>
              <span className="text-[var(--fg-dim)]">
                → tts input ::{" "}
                <span className="phosphor-soft">
                  {estimatedFinalChars.toLocaleString()} chars
                </span>
              </span>
              {provider === "openai" && openaiModel && (
                <span className="text-[var(--fg-dim)]">
                  → cost ::{" "}
                  <span className="phosphor">
                    ${estimatedUsd.toFixed(4)}
                  </span>{" "}
                  <span className="text-[var(--fg-mute)]">
                    ({openaiModel.costPer1M}/1M chars)
                  </span>
                </span>
              )}
              {provider === "elevenlabs" && (
                <span className="text-[var(--fg-dim)]">
                  → cost ::{" "}
                  <span className={willExceedQuota ? "alert" : "phosphor"}>
                    {estimatedCredits.toLocaleString()} credits
                  </span>
                  {quotaRemaining !== null && (
                    <span className="text-[var(--fg-mute)]">
                      {" "}
                      (of {quotaRemaining.toLocaleString()} remaining)
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* ═══ EXECUTE ═══ */}
      <div className="mt-4">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`group relative flex w-full items-center justify-center overflow-hidden border-2 py-5 text-[13px] font-bold uppercase tracking-[0.3em] transition-all ${
            canGenerate
              ? "border-[var(--phosphor)] bg-[var(--bg-panel)] hover:bg-[var(--phosphor)] hover:text-[var(--bg)]"
              : "border-[var(--border)] bg-[var(--bg-panel)] text-[var(--fg-mute)]"
          }`}
        >
          {loading && <div className="scan-bar" />}
          <span
            className={
              canGenerate ? "phosphor group-hover:[text-shadow:none] group-hover:text-[var(--bg)]" : ""
            }
          >
            {loading
              ? ">>  TRANSMITTING  <<"
              : canGenerate
                ? ">>  EXECUTE  <<"
                : "<<  AWAITING INPUT  >>"}
          </span>
        </button>
      </div>

      {/* ═══ PIPELINE / STATUS ═══ */}
      {(loading || error || audioUrl) && (
        <div className="mt-4">
          <Panel
            title={error ? "ERROR" : loading ? "PIPELINE" : "OUTPUT"}
            tone={error ? "alert" : loading ? "busy" : "default"}
            meta={
              error
                ? "RUNTIME_FAULT"
                : loading
                  ? "PROCESSING"
                  : `0x${audioFileId} :: ${fmtBytes(audioSize)}`
            }
          >
            {error && (
              <div className="space-y-2 text-[11px] leading-relaxed">
                {/* Quota-exceeded error — custom structured display */}
                {error.includes("quota_exceeded") ? (
                  <>
                    <div className="alert uppercase tracking-wider">
                      [FATAL] :: QUOTA_EXCEEDED
                    </div>
                    {(() => {
                      const required = error.match(/(\d+) credits are required/i)?.[1];
                      const remaining = error.match(/have (\d+) credits remaining/i)?.[1];
                      const total = error.match(/quota of (\d+)/i)?.[1];
                      return (
                        <div className="space-y-1 text-[var(--fg-dim)]">
                          <div>
                            {">"} monthly quota ::{" "}
                            <span className="phosphor-soft">{total ? parseInt(total).toLocaleString() : "?"}</span>{" "}
                            credits
                          </div>
                          <div>
                            {">"} remaining ::{" "}
                            <span className="amber-glow">
                              {remaining ? parseInt(remaining).toLocaleString() : "?"}
                            </span>{" "}
                            credits
                          </div>
                          <div>
                            {">"} this request needs ::{" "}
                            <span className="alert">
                              {required ? parseInt(required).toLocaleString() : "?"}
                            </span>{" "}
                            credits
                          </div>
                        </div>
                      );
                    })()}
                    <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
                      <div className="phosphor-soft uppercase tracking-[0.2em] text-[10px]">
                        &gt;&gt; options:
                      </div>
                      <div className="text-[var(--fg-dim)]">
                        <span className="phosphor">[1]</span> switch model to{" "}
                        <span className="phosphor-soft">eleven_flash_v2_5</span> (0.5x credit cost) — already your default now
                      </div>
                      <div className="text-[var(--fg-dim)]">
                        <span className="phosphor">[2]</span> reduce input size — try just the abstract or first few paragraphs
                      </div>
                      <div className="text-[var(--fg-dim)]">
                        <span className="phosphor">[3]</span> upgrade ::{" "}
                        <a
                          href="https://elevenlabs.io/app/subscription"
                          target="_blank"
                          rel="noreferrer"
                          className="phosphor-soft underline hover:phosphor"
                        >
                          elevenlabs.io/app/subscription
                        </a>
                        {" "}— starter ($5/mo) gives 30k/month
                      </div>
                      <div className="text-[var(--fg-dim)]">
                        <span className="phosphor">[4]</span> wait for monthly
                        reset (your quota refreshes on your billing date)
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="alert">[FATAL] :: {error}</div>
                    <div className="text-[var(--fg-dim)]">
                      {">"} check console or retry. if this persists, the upstream
                      service may be down or the input buffer may be malformed.
                    </div>
                  </>
                )}
              </div>
            )}

            {loading && !error && (
              <PipelineDisplay running={loading} useLlm={useLlmRewrite} />
            )}

            {audioUrl && !loading && !error && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 border border-[var(--border)] bg-[var(--bg)] p-2 text-[10px]">
                  <div>
                    <span className="text-[var(--fg-dim)]">FILE_ID :: </span>
                    <span className="phosphor-soft">0x{audioFileId}</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-dim)]">SIZE :: </span>
                    <span className="phosphor-soft">{fmtBytes(audioSize)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-dim)]">FORMAT :: </span>
                    <span className="phosphor-soft">mp3/44100/128kbps</span>
                  </div>
                  <div>
                    <span className="text-[var(--fg-dim)]">STATUS :: </span>
                    <span className="phosphor">[ READY ]</span>
                  </div>
                </div>

                <audio controls src={audioUrl} />

                <a
                  href={audioUrl}
                  download={audioFilename}
                  className="group inline-flex items-center gap-2 border border-[var(--phosphor)] px-4 py-2 text-[11px] uppercase tracking-wider phosphor transition-colors hover:bg-[var(--phosphor)] hover:text-[var(--bg)] hover:[text-shadow:none]"
                >
                  {"[ DOWNLOAD .MP3 ]"}
                  <span className="text-[var(--fg-dim)] group-hover:text-[var(--bg)]">
                    → {audioFilename}
                  </span>
                </a>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ═══ FOOTER ═══ */}
      <footer className="mt-10 space-y-1 border-t border-[var(--border)] pt-4 text-[10px] text-[var(--fg-ghost)]">
        <div>
          {"// paper_reader :: cypherpunk ascii-core :: built on next.js 16 + tailwind v4"}
        </div>
        <div>
          {"// pipeline :: "}
          <span className="text-[var(--fg-dim)]">unpdf</span>
          {" → "}
          <span className="text-[var(--fg-dim)]">regex_clean</span>
          {" → "}
          <span className="text-[var(--fg-dim)]">anthropic_rewrite</span>
          {" → "}
          <span className="text-[var(--fg-dim)]">chunk</span>
          {" → "}
          <span className="text-[var(--fg-dim)]">elevenlabs_tts</span>
          {" → "}
          <span className="text-[var(--fg-dim)]">concat</span>
        </div>
        <div>
          {"// status :: "}
          <span className="phosphor-dim">[ ONLINE ]</span>
          {" "}
          <span className="blink">█</span>
        </div>
      </footer>
    </main>
  );
}
