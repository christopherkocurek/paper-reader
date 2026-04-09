/**
 * PDF text extraction using unpdf.
 *
 * unpdf is a serverless-friendly PDF library that doesn't need worker setup
 * or native bindings, so it runs cleanly in Next.js API routes both locally
 * and on Vercel.
 */

import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}
