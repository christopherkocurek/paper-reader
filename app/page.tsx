"use client";

/**
 * PAPER_READER :: cypherpunk ascii-core interface
 *
 * Three input modes, terminal aesthetic, phosphor-green CRT vibe.
 * Same pipeline as before — this file is a visual rewrite only.
 */

import { useEffect, useState, useRef, type ReactNode } from "react";

type Voice = {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

type Mode = "paste" | "txt" | "pdf";

const MODELS = [
  { id: "eleven_multilingual_v2", label: "eleven_multilingual_v2  ::  max fidelity" },
  { id: "eleven_turbo_v2_5", label: "eleven_turbo_v2_5  ::  low latency" },
  { id: "eleven_v3", label: "eleven_v3  ::  experimental" },
];

const NARRATION_VOICES = new Set([
  "Brian", "Adam", "Rachel", "George", "Daniel", "Antoni", "Sarah", "Charlotte", "Matilda",
]);

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
}: {
  sessionId: string;
  state: "idle" | "busy" | "ready" | "err";
  charCount: number;
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

  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("eleven_multilingual_v2");
  const [useLlmRewrite, setUseLlmRewrite] = useState(true);

  const [loading, setLoading] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioSize, setAudioSize] = useState<number>(0);
  const [audioFilename, setAudioFilename] = useState<string>("paper.mp3");
  const [audioFileId] = useState(() => hexId());
  const lastObjectUrlRef = useRef<string | null>(null);

  // Fetch voices on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/voices");
        if (!res.ok)
          throw new Error(
            (await res.json()).error ?? "VOICE_REGISTRY_FETCH_FAILED",
          );
        const data = await res.json();
        const vs = data.voices as Voice[];
        vs.sort((a, b) => {
          const sA = NARRATION_VOICES.has(a.name.split(" ")[0]) ? 0 : 1;
          const sB = NARRATION_VOICES.has(b.name.split(" ")[0]) ? 0 : 1;
          if (sA !== sB) return sA - sB;
          return a.name.localeCompare(b.name);
        });
        setVoices(vs);
        const brian = vs.find((v) => v.name.startsWith("Brian"));
        const firstNarr = vs.find((v) => NARRATION_VOICES.has(v.name.split(" ")[0]));
        setVoiceId((brian ?? firstNarr ?? vs[0])?.voice_id ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "UNKNOWN_ERROR");
      } finally {
        setLoadingVoices(false);
      }
    })();
    return () => {
      if (lastObjectUrlRef.current) URL.revokeObjectURL(lastObjectUrlRef.current);
    };
  }, []);

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioSize(0);

    try {
      const form = new FormData();
      form.set("voiceId", voiceId);
      form.set("modelId", modelId);
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
      setError(e instanceof Error ? e.message : "UNKNOWN_ERROR");
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

  const state: "idle" | "busy" | "ready" | "err" = error
    ? "err"
    : loading
      ? "busy"
      : audioUrl
        ? "ready"
        : "idle";

  const canGenerate =
    !loading &&
    !!voiceId &&
    (mode === "paste"
      ? pasteText.trim().length > 0
      : mode === "txt"
        ? !!txtFile
        : !!pdfFile);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* ═══ TOP STATUS BAR ═══ */}
      <StatusBar sessionId={sessionId} state={state} charCount={bufferChars} />

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
        <Panel title="CONFIG" meta={<span>{MODELS.length} models loaded</span>}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--fg-dim)]">
                {">>"} voice_registry
              </div>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                disabled={loadingVoices}
                className="w-full text-[12px]"
              >
                {loadingVoices && <option>{">> loading voices <<"}</option>}
                {!loadingVoices && voices.length === 0 && (
                  <option>NO_VOICES_AVAILABLE</option>
                )}
                {voices.map((v) => {
                  const isNarration = NARRATION_VOICES.has(v.name.split(" ")[0]);
                  return (
                    <option key={v.voice_id} value={v.voice_id}>
                      {isNarration ? "★ " : "  "}
                      {v.name}
                    </option>
                  );
                })}
              </select>
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
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* LLM rewrite toggle */}
          <label className="mt-4 flex cursor-pointer items-start gap-3 border border-[var(--border)] bg-[var(--bg)] p-3">
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
                {">"} claude rewrites text for natural narration :: expands
                acronyms, converts math to words, breaks dense sentences, drops
                figure refs. disable for faster / cheaper runs.
              </div>
            </div>
          </label>
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
                <div className="alert">[FATAL] :: {error}</div>
                <div className="text-[var(--fg-dim)]">
                  {">"} check console or retry. if this persists, the upstream
                  service may be down or the input buffer may be malformed.
                </div>
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
