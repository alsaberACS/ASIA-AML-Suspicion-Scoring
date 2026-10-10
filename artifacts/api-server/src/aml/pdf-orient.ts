import { PDFDocument, degrees } from "pdf-lib";

/**
 * Page-orientation helpers for scanned declaration PDFs.
 *
 * Office scanners routinely store a landscape form as a portrait page with
 * the content lying on its side. Vision models read sideways Arabic
 * handwriting markedly worse than upright text, so before the readers see
 * the PDF we detect the rotation once and hand them a copy whose pages
 * carry a /Rotate entry. Only the page dictionaries change - the scanned
 * images are untouched - and the stored original is never modified, so the
 * locator (which works in raw page axes) and the viewer keep their frame.
 */

export type PageRotation = 0 | 90 | 180 | 270;

export const PAGE_ROTATIONS: readonly PageRotation[] = [0, 90, 180, 270];

export const isPageRotation = (v: unknown): v is PageRotation =>
  typeof v === "number" && (PAGE_ROTATIONS as readonly number[]).includes(v);

const loadPdf = (contentBase64: string) =>
  PDFDocument.load(Buffer.from(contentBase64, "base64"), {
    ignoreEncryption: true,
    updateMetadata: false,
  });

/**
 * Builds the 4-page orientation probe: the first page of the document
 * repeated with 0, 90, 180 and 270 degrees of additional clockwise
 * rotation. Asking a model "which of these is upright" is far more reliable
 * than asking it to estimate an angle from a single sideways page.
 */
export async function buildOrientationProbe(contentBase64: string): Promise<string> {
  const src = await loadPdf(contentBase64);
  if (src.getPageCount() === 0) throw new Error("PDF has no pages");
  const out = await PDFDocument.create();
  const copies = await out.copyPages(src, [0, 0, 0, 0]);
  copies.forEach((page, i) => {
    page.setRotation(degrees((page.getRotation().angle + i * 90) % 360));
    out.addPage(page);
  });
  return Buffer.from(await out.save()).toString("base64");
}

/**
 * Returns a copy of the PDF with every page turned a further `rotation`
 * degrees clockwise (via the page /Rotate entry). Returns the input
 * unchanged for rotation 0.
 */
export async function rotatePdfPages(
  contentBase64: string,
  rotation: PageRotation,
): Promise<string> {
  if (rotation === 0) return contentBase64;
  const doc = await loadPdf(contentBase64);
  for (const page of doc.getPages()) {
    page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
  }
  return Buffer.from(await doc.save()).toString("base64");
}

/**
 * A single-page PDF holding page `index` (negative counts from the end, so
 * -1 is the last page). The page keeps its /Rotate entry, so extracting from
 * the readable copy yields an upright page.
 */
export async function extractPage(contentBase64: string, index: number): Promise<string> {
  const src = await loadPdf(contentBase64);
  const n = src.getPageCount();
  if (n === 0) throw new Error("PDF has no pages");
  const i = ((index % n) + n) % n;
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [i]);
  out.addPage(page);
  return Buffer.from(await out.save()).toString("base64");
}

/** Number of pages, or null when the PDF cannot be parsed. */
export async function countPdfPages(contentBase64: string): Promise<number | null> {
  try {
    return (await loadPdf(contentBase64)).getPageCount();
  } catch {
    return null;
  }
}

/** Maps the probe's answer ("2") back to the clockwise rotation needed. */
export function rotationFromProbeAnswer(answer: string): PageRotation | null {
  const m = answer.match(/[1-4]/);
  if (!m) return null;
  return PAGE_ROTATIONS[Number(m[0]) - 1] ?? null;
}
