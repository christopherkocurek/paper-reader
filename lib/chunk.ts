/**
 * Sentence-boundary chunker for ElevenLabs TTS.
 *
 * ElevenLabs has a ~5000 char limit per TTS request. For voice continuity,
 * shorter chunks (~1500-2500 chars) work better because we can chain them
 * with `previous_request_ids` without hitting context limits.
 *
 * The chunker splits on sentence boundaries (. ! ?) and prefers paragraph
 * breaks when available. Never splits mid-sentence.
 */

const TARGET = 2000;
const MAX = 2800;
const MIN = 400;

/**
 * Split text into sentences using a regex that respects common abbreviations
 * like "Dr." "Mr." "U.S." etc.
 */
function splitSentences(text: string): string[] {
  // Protect common abbreviations by replacing their periods
  const PROTECT: Record<string, string> = {
    "Dr.": "Dr§",
    "Mr.": "Mr§",
    "Mrs.": "Mrs§",
    "Ms.": "Ms§",
    "St.": "St§",
    "vs.": "vs§",
    "U.S.": "U§S§",
    "U.K.": "U§K§",
    "Ph.D.": "Ph§D§",
  };
  let protectedText = text;
  for (const [k, v] of Object.entries(PROTECT)) {
    protectedText = protectedText.replaceAll(k, v);
  }

  // Split on sentence-ending punctuation followed by whitespace and a capital letter or end
  const parts = protectedText.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);

  // Restore protected abbreviations
  return parts.map((p) => {
    let restored = p;
    for (const [k, v] of Object.entries(PROTECT)) {
      restored = restored.replaceAll(v, k);
    }
    return restored.trim();
  }).filter(Boolean);
}

/**
 * Greedily pack sentences into chunks no larger than MAX characters,
 * aiming for TARGET characters, never less than MIN (except final chunk).
 *
 * Paragraph breaks (double newlines) are respected as soft boundaries:
 * a chunk will prefer to end at a paragraph break if it's already above MIN.
 */
export function chunkText(text: string): string[] {
  if (!text.trim()) return [];

  // Split into paragraphs first to respect semantic breaks
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  // Each paragraph becomes a list of sentences
  const allSentences: Array<{ sentence: string; endsParagraph: boolean }> = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const sentences = splitSentences(paragraphs[i]);
    for (let j = 0; j < sentences.length; j++) {
      allSentences.push({
        sentence: sentences[j],
        endsParagraph: j === sentences.length - 1,
      });
    }
  }

  const chunks: string[] = [];
  let current = "";

  for (let i = 0; i < allSentences.length; i++) {
    const { sentence, endsParagraph } = allSentences[i];
    const sep = current ? (endsParagraph ? "\n\n" : " ") : "";
    const candidate = current + sep + sentence;

    if (candidate.length > MAX && current) {
      // Current chunk is full — flush
      chunks.push(current);
      current = sentence;
      continue;
    }

    current = candidate;

    // If we just crossed TARGET and this sentence ended a paragraph, flush at a
    // natural boundary rather than waiting for the hard MAX ceiling.
    if (current.length >= TARGET && endsParagraph && current.length >= MIN) {
      chunks.push(current);
      current = "";
    }
  }

  if (current.trim()) chunks.push(current);

  // Safety: force-split any chunk still over MAX (happens if a single paragraph
  // has no sentence breaks, e.g. a run-on block from bad PDF extraction).
  const safe: string[] = [];
  for (const c of chunks) {
    if (c.length <= MAX) {
      safe.push(c);
    } else {
      for (let i = 0; i < c.length; i += MAX) {
        safe.push(c.slice(i, i + MAX));
      }
    }
  }

  return safe;
}
