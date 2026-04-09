/**
 * LLM preprocessing pass using Anthropic Claude.
 *
 * This is the pass that actually fixes the "monotone output" problem. Regex
 * cleanup (clean.ts) handles mechanical artifacts; Claude handles semantic
 * ones:
 *
 *   - Expands acronyms on first use so TTS says "language model" not "L L M"
 *   - Converts math notation to spoken words ("x^2" → "x squared")
 *   - Restructures dense academic sentences into natural narration
 *   - Adds pacing punctuation (commas for pauses, periods to break run-ons)
 *   - Drops leftover figure/table references the regex missed
 *   - Preserves meaning exactly — does not summarize or editorialize
 *
 * Self-recursive loop: after rewriting, we check the output for residual
 * artifacts. If the quality check flags issues, we run a second refinement
 * pass with targeted instructions. Bounded at 2 refinement iterations to
 * prevent runaway loops.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";
const MAX_REFINEMENT_ITERATIONS = 2;

// Lazy-init so the module can be imported without env vars present at build time
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM_PROMPT = `You rewrite academic and research text so it sounds natural when read aloud by a text-to-speech engine. Your goal is *spoken narration quality*, not written prose quality.

RULES — follow all of these:

1. **Preserve meaning exactly.** Do not summarize, omit content, or editorialize. Every fact and claim in the input must appear in the output.

2. **Expand acronyms on first use.** If the text introduces "LLM" as "large language model (LLM)", the LLM acronym will sound like "L L M" in TTS. Rewrite as "large language models" throughout. Same for "RL" → "reinforcement learning", "CNN" → "convolutional neural network", etc. Only keep short acronyms that are genuinely pronounced as words (NASA, NATO, LASER).

3. **Convert math and notation to spoken words.**
   - "x^2" → "x squared"
   - "sum_{i=1}^n" → "the sum from i equals 1 to n"
   - "10^-6" → "ten to the negative six"
   - "≈" → "approximately"
   - "∈" → "in"
   - Greek letters: "α" → "alpha", "β" → "beta", etc.
   - Skip equations that cannot be naturally verbalized. Replace with "an equation relating [the relevant variables]" and continue.

4. **Break up dense sentences.** Long academic sentences with multiple clauses become exhausting to listen to. Split into 2-3 shorter sentences when a sentence exceeds ~30 words. Use commas to mark natural pauses.

5. **Drop leftover structural references.** "Figure 3 shows", "as we discussed in Section 4.2", "the results in Table 1" — either drop these entirely or rewrite to the essential claim without the reference.

6. **Keep narrative flow between chunks.** This text is one chunk of a longer document. Do not add "in this chunk" or "in summary" or "in conclusion". Start and end naturally, as if the listener is in the middle of the article.

7. **Do not add commentary, headers, or markdown.** Output plain prose only. No "**bold**", no bullet lists, no "Here is the rewritten text:". Just the rewritten narration.

8. **Length.** Output should be similar in length to input, or slightly shorter. Do not pad. Do not add filler phrases like "it is interesting to note that".

OUTPUT FORMAT: Plain prose only, nothing else.`;

const REFINEMENT_PROMPT = `The previous rewrite still contains artifacts that will sound bad in TTS. Specifically, it contains one or more of: unexpanded short acronyms that will be spelled out letter-by-letter, leftover math symbols, figure/table references, or URL/DOI fragments.

Rewrite the text below one more time, following the same rules as before but paying extra attention to these issues. Output plain prose only.`;

/**
 * Quality check: scan output for residual artifacts that will sound bad in TTS.
 * Returns true if the text is clean, false if it needs another pass.
 */
function isClean(text: string): boolean {
  // Short uppercase acronyms that TTS will spell letter-by-letter (2-4 caps, not a common word)
  const acronymAllowlist = new Set(["NASA", "NATO", "LASER", "RADAR", "SCUBA", "UNESCO", "UNICEF", "OPEC", "FAQ", "CEO", "CFO", "USA", "USSR", "EU", "UN", "AI", "ML"]);
  const shortAcronyms = text.match(/\b[A-Z]{2,5}\b/g) || [];
  const unknownAcronyms = shortAcronyms.filter((a) => !acronymAllowlist.has(a));
  // Allow up to 2 — speakers tolerate "AI" or "API" occasionally, but more means bad rewrite
  if (unknownAcronyms.length > 3) return false;

  // Leftover math symbols
  if (/[∑∏∫∂∞≈≠≤≥±∈∉⊂⊃∪∩∀∃]/.test(text)) return false;
  if (/\$[^$]+\$/.test(text)) return false;
  if (/\\[a-zA-Z]+\{/.test(text)) return false;

  // Leftover figure/table references
  if (/\b(fig\.?|figure|table|eq\.?|equation)\s+\d+/i.test(text)) return false;

  // Leftover URLs/DOIs
  if (/\b(https?:\/\/|www\.|doi:)/i.test(text)) return false;

  // Leftover citation brackets
  if (/\[\s*\d+/.test(text)) return false;

  return true;
}

/**
 * Rewrite a single chunk for natural narration.
 */
export async function rewriteChunk(chunk: string): Promise<string> {
  const client = getClient();

  let current = chunk;
  let iteration = 0;

  while (iteration <= MAX_REFINEMENT_ITERATIONS) {
    const isFirstPass = iteration === 0;
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: isFirstPass
            ? `Rewrite this text for natural spoken narration:\n\n${current}`
            : `${REFINEMENT_PROMPT}\n\n${current}`,
        },
      ],
    });

    const output = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!output) {
      // LLM returned nothing — bail with the most recent good version
      return current;
    }

    current = output;

    if (isClean(current)) {
      return current;
    }

    iteration++;
  }

  // Hit the refinement cap — return what we have
  return current;
}

/**
 * Rewrite all chunks in parallel (with a concurrency limit).
 */
export async function rewriteChunks(chunks: string[]): Promise<string[]> {
  const CONCURRENCY = 4;
  const results: string[] = new Array(chunks.length);

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const rewritten = await Promise.all(batch.map((c) => rewriteChunk(c)));
    for (let j = 0; j < rewritten.length; j++) {
      results[i + j] = rewritten[j];
    }
  }

  return results;
}
