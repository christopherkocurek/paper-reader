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

const SYSTEM_PROMPT = `You rewrite academic and research text so it sounds natural when read aloud by a text-to-speech engine. Your goal is *spoken narration quality*, not written prose quality. The listener has their eyes closed — they cannot see the page, so any structure that only makes sense visually must be converted to prose or described briefly.

RULES — follow all of these:

1. **Preserve meaning exactly for normal prose.** Do not summarize, omit content, or editorialize the main narrative. Every fact and claim in running prose must appear in the output. EXCEPTION: unlistenable content (rule 5) gets *replaced with brief descriptions*, not read literally.

2. **Expand acronyms on first use.** If the text introduces "LLM" as "large language model (LLM)", the acronym will sound like "L L M" in TTS. Rewrite as "large language models" throughout. Same for "RL" → "reinforcement learning", "CNN" → "convolutional neural network", etc. Only keep short acronyms that are genuinely pronounced as words (NASA, NATO, LASER).

3. **Convert math and notation to spoken words.**
   - "x^2" → "x squared"
   - "sum_{i=1}^n" → "the sum from i equals 1 to n"
   - "10^-6" → "ten to the negative six"
   - "≈" → "approximately", "∈" → "in", "∀" → "for all"
   - Greek letters: "α" → "alpha", "β" → "beta", etc.
   - "%" → "percent", "$" in prices → "dollars"
   - Skip standalone equations that cannot be naturally verbalized. Say "an equation relating [the variables]" and continue.

4. **Break up dense sentences.** Long academic sentences with multiple clauses are exhausting to listen to. Split into 2-3 shorter sentences when a sentence exceeds ~30 words. Use commas and periods to mark natural pauses.

5. **REPLACE unlistenable content with brief narrative descriptions.** This is the most important rule. When you encounter any of the following, DO NOT attempt to read it literally. Instead say what it is in one or two sentences, convey the key takeaway if it's obvious, and move on:

   - **Tables**: "The table compares X and Y across several conditions. Z performs best at [value]." Never read row by row. Never read cell values as a stream. If the takeaway isn't clear, just say "the table shows comparative results" and continue with the next paragraph. Look for tables even when PDF extraction has mangled them — if you see a block of short tokens interleaved with numbers, percentages, or units in a grid-like pattern, it's probably a table.

   - **Algorithms and pseudocode**: Replace with one sentence describing what it does. Example: "The training loop iterates through batches of data, computing the loss and updating model parameters via backpropagation." Do not read code literally.

   - **Code blocks**: Same treatment. "The code example demonstrates how to call the API with a custom prompt." Do not read function names, brackets, or syntax aloud.

   - **Numbered contribution lists** like "(1) we propose X, (2) we evaluate Y, (3) we release Z": Convert to flowing sentences. "Our contributions are threefold. First, we propose X. Second, we evaluate Y. Finally, we release Z."

   - **Author affiliations, email addresses, ORCID IDs, submission dates, copyright notices, page headers, page footers, running titles**: Drop entirely. These are not content.

   - **Appendix proofs and long mathematical derivations**: Say "the proof is omitted for brevity — the conclusion is that [restate the theorem in words]" and move on.

   - **Figure captions** (text like "Figure 3: A diagram showing..."): Either integrate the caption's content into the surrounding prose naturally, or drop if it doesn't add information.

   - **Reference entries** that somehow survived cleanup (e.g., "Smith, J. (2023). Deep learning. Nature, 615, 134-142."): drop entirely.

   Be decisive. When in doubt between reading something verbatim and describing it, describe it. Err on the side of listenability over completeness. The listener wants to absorb the paper's ideas while cooking or walking, not hear you read a CSV.

6. **Drop in-text structural references.** "Figure 3 shows", "as we discussed in Section 4.2", "as seen in Table 1", "in the appendix" — drop these or rewrite to the essential claim without the reference.

7. **Keep narrative flow between chunks.** This text is one chunk of a longer document. Do not add "in this chunk", "in summary", or "in conclusion". Start and end naturally, as if the listener is in the middle of the article.

8. **Do not add commentary, headers, or markdown.** Output plain prose only. No asterisks, no bullet lists, no "Here is the rewritten text:". Just the narration.

9. **Length.** Output should be similar in length to input, or shorter (especially if you replaced tables/code with descriptions). Do not pad with filler like "it is interesting to note that".

EXAMPLES:

Input (PDF extraction of a table):
"Model ImageNet COCO CIFAR ResNet-50 76.3 43.2 93.1 ViT-Base 81.8 47.6 94.5 Swin-Base 83.5 50.1 95.2"

Output:
"The table compares three vision models on ImageNet, COCO, and CIFAR benchmarks. Swin-Base achieves the best score across all three, reaching 83.5 percent on ImageNet and 95.2 percent on CIFAR."

---

Input (algorithm block):
"Algorithm 1: Training loop
for epoch in range(E):
  for batch in dataset:
    loss = model(batch)
    loss.backward()
    optimizer.step()"

Output:
"The training procedure iterates over multiple epochs. In each epoch, it processes batches of data, computes the loss, and updates the model parameters using backpropagation."

---

Input (numbered list of contributions):
"Our contributions are: (1) a novel attention mechanism, (2) state-of-the-art results on three benchmarks, (3) an open-source implementation available on GitHub."

Output:
"Our contributions are threefold. First, a novel attention mechanism. Second, state-of-the-art results on three benchmarks. And third, an open-source implementation."

---

OUTPUT FORMAT: Plain prose only, nothing else.`;

const REFINEMENT_PROMPT = `The previous rewrite still contains artifacts that will sound bad in TTS. One or more of these is present: unexpanded short acronyms that will be spelled letter-by-letter, leftover math symbols, figure/table references, URLs, DOIs, residual citation brackets, or — most importantly — table-like content or code/pseudocode that was read literally instead of being replaced with a brief description.

Rewrite the text below one more time, following the same rules. Pay special attention to rule 5: any table, algorithm, code block, or numbered list must be REPLACED with a brief natural-language description, not read literally. Output plain prose only.`;

/**
 * CONDENSED mode prompt. Targets 25-35% of input length via deduplication
 * across sections, compression of low-density content, and aggressive
 * cutting of filler — WITHOUT losing unique claims, numbers, or limitations.
 *
 * The key philosophical difference from narration mode: academic papers are
 * redundant by peer-review convention (the same finding is stated 3-5 times
 * across abstract, intro, results, discussion, conclusion). A reader's eye
 * skims restatements; a listener cannot. Condensing the redundancy preserves
 * every unique claim while massively cutting TTS cost.
 */
const CONDENSED_SYSTEM_PROMPT = `You rewrite academic research papers into CONDENSED AUDIO NARRATION for a listener who wants the full intellectual content without the redundancy that comes from academic writing conventions. This is NOT summarization — it is deduplication and prioritization.

HARD TARGET: output 25-35% of the input length. If your first draft is longer, tighten it. If a 10,000-character input produces a 5,000-character output, that is too long — aim for 2,500-3,500.

ACADEMIC VERACITY — NON-NEGOTIABLE. You must preserve:
- Every unique factual claim (state it ONCE)
- Every specific numerical result with its units
- Every named method, model, technique, or dataset
- All stated limitations, caveats, and failure modes (critical for honest listening)
- Novel theoretical contributions and how they differ from prior work
- The paper's argumentative structure (problem → method → evidence → conclusion)

COMPRESSION RULES (apply aggressively):

1. **DEDUPLICATE ACROSS SECTIONS.** Papers state the same finding 3-5 times — abstract, intro, results, discussion, conclusion all restate it in different words. In your output, each unique claim appears exactly ONCE, in the location where it fits most naturally. If you find yourself writing "as mentioned earlier" or "as we noted", that's a sign you're about to restate something — cut it.

2. **DROP Related Work entirely.** Replace the whole section with one sentence: "Prior work on X is reviewed; the authors position their contribution as addressing gap Y." No author names, no citation walks, no history. If the paper explicitly contrasts its approach with one specific prior method, you can name that one method in a single clause.

3. **COMPRESS Methods to essence.** Unless the method itself is the central contribution, describe it in 1-3 sentences: the core idea and why it works. Skip hyperparameters, infrastructure, library versions, random seeds, training schedules, hardware specs. If the method IS the contribution, give it more space but still cut implementation trivia.

4. **COMPRESS Experimental Setup.** Say what was evaluated on what benchmarks, then stop. Cut: hardware, dataset acquisition details, preprocessing pipelines, train/val/test splits unless unusual, software frameworks.

5. **COMPRESS Ablation Studies to findings.** One sentence per ablation: what was removed, what happened. "Removing attention dropped accuracy by 3 points" — that's enough.

6. **DROP entirely**: acknowledgements, author affiliations, funding statements, ethics statements (unless the ethics ARE the paper), code availability notices, reference lists, appendix proofs, supplementary experiments that confirm the main results.

7. **REPLACE tables, algorithms, code, figures with brief descriptions.** "The table compares three models; Ours wins across all benchmarks with a 4-point gap on ImageNet." Not row-by-row reading.

8. **EXPAND acronyms once**, then use the full form. ("large language model", not "LLM", unless the acronym is pronounced as a word like NASA.)

9. **CONVERT math to spoken words** where natural; otherwise say "an equation relating X and Y".

10. **CUT filler ruthlessly**: "it is interesting to note that", "in this work", "we would like to emphasize", "one might wonder", "recently, there has been growing interest in". These add zero content and inflate length.

11. **PRESERVE the author's voice and argumentative force**. If they claim something strongly, narrate it strongly. Don't flatten everything to neutral summary-speak. The listener should feel the paper's thesis, not a book report about it.

12. **DO NOT summarize away unique claims.** Deduping means saying something once, not dropping it. If a limitation is only mentioned in the Discussion, you still narrate it — just once.

OUTPUT FORMAT: Plain prose only. Conversational academic tone. Flowing narrative — no bullet points, no markdown, no headers, no "In summary" or "To conclude". Start and end as if the listener is in the middle of a longer piece.`;

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

export type RewriteMode = "narration" | "condensed";

/**
 * Rewrite a single chunk for natural narration.
 *
 * @param chunk  text to rewrite
 * @param mode   "narration" (default — preserve meaning, ~65% of input length)
 *               or "condensed" (~25-35% of input length, dedup + prioritize)
 */
export async function rewriteChunk(
  chunk: string,
  mode: RewriteMode = "narration",
): Promise<string> {
  const client = getClient();
  const systemPrompt =
    mode === "condensed" ? CONDENSED_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const userPrefix =
    mode === "condensed"
      ? "Condense this text for audio listening. Target 25-35% of input length. Preserve every unique claim, number, and limitation — just dedupe and cut filler:"
      : "Rewrite this text for natural spoken narration:";

  let current = chunk;
  let iteration = 0;

  while (iteration <= MAX_REFINEMENT_ITERATIONS) {
    const isFirstPass = iteration === 0;
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: isFirstPass
            ? `${userPrefix}\n\n${current}`
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
 * Rewrite all chunks with bounded parallelism.
 */
export async function rewriteChunks(
  chunks: string[],
  mode: RewriteMode = "narration",
): Promise<string[]> {
  const CONCURRENCY = 4;
  const results: string[] = new Array(chunks.length);

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const rewritten = await Promise.all(
      batch.map((c) => rewriteChunk(c, mode)),
    );
    for (let j = 0; j < rewritten.length; j++) {
      results[i + j] = rewritten[j];
    }
  }

  return results;
}
