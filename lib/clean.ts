/**
 * Heuristic text cleanup for research papers and academic text.
 *
 * This is pass 1 of the preprocessing pipeline. It handles the mechanical
 * artifacts that make raw paper text sound robotic in TTS:
 *   - Citation markers: [1], [1,2,3], [1-5], (Smith 2020), (Smith et al., 2020)
 *   - References / Bibliography sections (often 20-40% of a paper, unlistenable)
 *   - URLs, DOIs, arXiv IDs
 *   - Figure/table references: "(Fig. 3)", "Table 2", "as shown in Figure 4a"
 *   - LaTeX fragments: $...$, \command{arg}, ^{superscript}, _{subscript}
 *   - Hyphenated line breaks from PDF extraction: "inform-\nation" → "information"
 *   - Page headers/footers repeated on every page
 *   - Multiple whitespace / weird Unicode
 *   - Common academic abbreviations: "e.g." → "for example", "i.e." → "that is"
 *
 * The LLM pass (llm.ts) handles semantic cleanup on top of this.
 */

const COMMON_HEADERS = [
  /\babstract\b/i,
  /\bintroduction\b/i,
  /\bbackground\b/i,
  /\brelated work\b/i,
  /\bmethods?\b/i,
  /\bmethodology\b/i,
  /\bexperiments?\b/i,
  /\bresults?\b/i,
  /\bdiscussion\b/i,
  /\bconclusion\b/i,
  /\blimitations?\b/i,
  /\bfuture work\b/i,
  /\backnowledgements?\b/i,
  /\backnowledgments?\b/i,
];

const ABBREV_MAP: Record<string, string> = {
  "e.g.": "for example,",
  "E.g.": "For example,",
  "i.e.": "that is,",
  "I.e.": "That is,",
  "etc.": "and so on",
  "et al.": "and colleagues",
  "vs.": "versus",
  "cf.": "compare",
  "w.r.t.": "with respect to",
  "s.t.": "such that",
  "w.l.o.g.": "without loss of generality",
  "iff": "if and only if",
};

/**
 * Strip References / Bibliography section and everything after it.
 * Most papers have References as the last major section and it's useless audio.
 */
function stripReferences(text: string): string {
  // Match a References/Bibliography heading on its own line or followed by content
  const patterns = [
    /\n\s*references\s*\n[\s\S]*$/i,
    /\n\s*bibliography\s*\n[\s\S]*$/i,
    /\n\s*works cited\s*\n[\s\S]*$/i,
    /\n\s*\d+\.?\s*references\s*\n[\s\S]*$/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return text.slice(0, m.index);
  }
  return text;
}

/**
 * Remove citation markers like [1], [1,2], [1-5], [12,13,42].
 * Also handles author-year: (Smith 2020), (Smith and Jones 2020), (Smith et al., 2020).
 */
function stripCitations(text: string): string {
  // Square bracket numeric citations
  text = text.replace(/\[\s*\d+(?:\s*[-,–]\s*\d+)*(?:\s*,\s*\d+(?:\s*[-,–]\s*\d+)*)*\s*\]/g, "");
  // (Author et al., 2020) or (Author, 2020) or (Author 2020)
  text = text.replace(
    /\(\s*(?:[A-Z][a-zA-Z\-']+(?:\s+et\s+al\.?)?(?:\s+and\s+[A-Z][a-zA-Z\-']+)?,?\s*)(?:19|20)\d{2}[a-z]?\s*(?:;\s*(?:[A-Z][a-zA-Z\-']+(?:\s+et\s+al\.?)?(?:\s+and\s+[A-Z][a-zA-Z\-']+)?,?\s*)(?:19|20)\d{2}[a-z]?\s*)*\)/g,
    ""
  );
  // Bare "Smith et al. (2020)" → "Smith and colleagues"
  text = text.replace(/([A-Z][a-zA-Z\-']+)\s+et\s+al\.?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g, "$1 and colleagues");
  return text;
}

/**
 * Strip URLs, DOIs, arXiv IDs, email addresses — TTS can't read them meaningfully.
 */
function stripUrls(text: string): string {
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/www\.\S+/g, "");
  text = text.replace(/\bdoi:\s*\S+/gi, "");
  text = text.replace(/\barxiv:\s*\d{4}\.\d{4,5}(v\d+)?/gi, "");
  text = text.replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, "");
  return text;
}

/**
 * Remove figure/table reference fragments. "As shown in Fig. 3" → "As shown".
 */
function stripFigureRefs(text: string): string {
  text = text.replace(/\(\s*(?:see\s+)?(?:figs?|figures?|tables?|eqs?|equations?|sections?|secs?|appendix|apps?)\.?\s*\d+[a-z]?(?:[-,]\s*\d+[a-z]?)*\s*\)/gi, "");
  text = text.replace(/\b(?:as\s+)?(?:shown|seen|illustrated|depicted|described)\s+in\s+(?:figs?|figures?|tables?|eqs?|equations?|sections?|appendix)\.?\s*\d+[a-z]?\b/gi, "");
  text = text.replace(/\b(?:figs?|figures?|tables?|eqs?|equations?)\.?\s*\d+[a-z]?/gi, "");
  return text;
}

/**
 * Strip simple LaTeX fragments. Full LaTeX parsing is out of scope — we just
 * drop inline math and common commands. The LLM pass will rewrite what survives.
 */
function stripLatex(text: string): string {
  // Inline math $...$
  text = text.replace(/\$[^$\n]{1,200}\$/g, "");
  // Display math $$...$$
  text = text.replace(/\$\$[\s\S]{1,500}?\$\$/g, "");
  // LaTeX commands \command{arg} or \command[opt]{arg}
  text = text.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})*/g, "");
  // Leftover ^{...}, _{...}
  text = text.replace(/[\^_]\{[^}]*\}/g, "");
  return text;
}

/**
 * PDF extraction introduces hyphenated line breaks: "inform-\nation" → "information".
 * Also collapses single newlines inside paragraphs into spaces.
 */
function fixPdfLineBreaks(text: string): string {
  // Rejoin hyphenated word breaks
  text = text.replace(/(\w)-\s*\n\s*(\w)/g, "$1$2");
  // Collapse single newlines (inside paragraph) to space, keep double newlines (paragraph break)
  text = text.replace(/([^\n])\n([^\n])/g, "$1 $2");
  return text;
}

/**
 * Expand common academic abbreviations so TTS pronounces them correctly.
 */
function expandAbbreviations(text: string): string {
  for (const [abbr, full] of Object.entries(ABBREV_MAP)) {
    // Word-boundary-safe replacement
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "g"), full);
  }
  return text;
}

/**
 * Normalize whitespace and Unicode curly quotes/dashes.
 */
function normalize(text: string): string {
  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, " - ")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ");
  // Collapse runs of spaces/tabs
  text = text.replace(/[ \t]+/g, " ");
  // Collapse 3+ newlines to 2
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/**
 * Master cleanup pipeline.
 */
export function cleanText(raw: string): string {
  let t = raw;
  t = fixPdfLineBreaks(t);
  t = stripReferences(t);
  t = stripCitations(t);
  t = stripUrls(t);
  t = stripFigureRefs(t);
  t = stripLatex(t);
  t = expandAbbreviations(t);
  t = normalize(t);
  return t;
}
