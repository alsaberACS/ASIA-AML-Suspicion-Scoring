import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, ChevronsRight, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Scanned form: pages render without text/annotation layers, so the
// react-pdf layer stylesheets are not needed here.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface InkBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A request to show where a value was read from: page, optional box, and a
 * sequence number so repeated requests for the same spot re-flash. */
export interface InkReveal {
  seq: number;
  page: number;
  box: InkBox | null;
}

const ROTATION_KEY = 'declaration-review:rotation';
const ROTATIONS = [0, 90, 180, 270] as const;
type Rotation = (typeof ROTATIONS)[number];

function savedRotation(): Rotation {
  try {
    const v = Number(localStorage.getItem(ROTATION_KEY));
    return (ROTATIONS as readonly number[]).includes(v) ? (v as Rotation) : 0;
  } catch {
    return 0;
  }
}

/**
 * Locator boxes are stored in the page's raw axes (as scanned). When the
 * viewer turns the page so the Arabic reads upright, the box must turn with
 * it. Rotation is clockwise, matching pdf.js.
 */
export function rotateBox(b: InkBox, rotation: number): InkBox {
  switch (rotation) {
    case 90:
      return { x0: 1 - b.y1, x1: 1 - b.y0, y0: b.x0, y1: b.x1 };
    case 180:
      return { x0: 1 - b.x1, x1: 1 - b.x0, y0: 1 - b.y1, y1: 1 - b.y0 };
    case 270:
      return { x0: b.y0, x1: b.y1, y0: 1 - b.x1, y1: 1 - b.x0 };
    default:
      return b;
  }
}

export default function DeclarationPdfPane({
  caseId,
  reveal,
  onPageChange,
  detectedRotation = null,
}: {
  caseId: number;
  reveal: InkReveal | null;
  onPageChange?: (page: number) => void;
  /**
   * Rotation the reading pipeline detected for this scan. When known it
   * wins over the remembered manual preference, so a sideways scan opens
   * upright; the rotate button still cycles from there.
   */
  detectedRotation?: number | null;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [rotation, setRotation] = useState<Rotation>(savedRotation);
  const [appliedDetected, setAppliedDetected] = useState<number | null>(null);

  // The extraction arrives after mount; apply its detected rotation once per
  // distinct value, then leave the user in control.
  useEffect(() => {
    if (detectedRotation === null || detectedRotation === appliedDetected) return;
    if ((ROTATIONS as readonly number[]).includes(detectedRotation)) {
      setRotation(detectedRotation as Rotation);
      setAppliedDetected(detectedRotation);
    }
  }, [detectedRotation, appliedDetected]);
  const [zoom, setZoom] = useState(1);
  const [paneWidth, setPaneWidth] = useState(0);
  const [visibleReveal, setVisibleReveal] = useState<InkReveal | null>(null);
  // Which page has actually painted. react-pdf hides the canvas while pdf.js
  // draws (the page shows as a white sheet meanwhile), so overlays wait for
  // this instead of appearing over a blank page.
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  const [pageRenderSeq, setPageRenderSeq] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Callback ref: the measured element mounts after the document loads,
  // so a plain ref + mount-time effect would observe nothing.
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setPaneWidth(el.clientWidth);
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setPaneWidth(e.contentRect.width);
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  useEffect(() => {
    onPageChange?.(pageNumber);
  }, [pageNumber, onPageChange]);

  // A reveal request jumps to its page. A located box stays pinned until the
  // next request (or the chip is clicked); a page-only reveal just flashes.
  useEffect(() => {
    if (!reveal) return;
    setPageNumber(() => (numPages ? Math.min(Math.max(1, reveal.page), numPages) : Math.max(1, reveal.page)));
    setVisibleReveal(reveal);
    if (reveal.box) return;
    const t = window.setTimeout(() => setVisibleReveal(null), 2200);
    return () => window.clearTimeout(t);
  }, [reveal, numPages]);

  // Bring the pinned region into view once the target page has painted.
  useEffect(() => {
    if (!visibleReveal?.box || !boxRef.current) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    boxRef.current.scrollIntoView({ block: 'center', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [visibleReveal, pageRenderSeq]);

  const cycleRotation = () => {
    setRotation(prev => {
      const next = ROTATIONS[(ROTATIONS.indexOf(prev) + 1) % ROTATIONS.length];
      try {
        localStorage.setItem(ROTATION_KEY, String(next));
      } catch {
        // private mode: rotation simply is not remembered
      }
      return next;
    });
  };

  // 32px padding + 2px sheet border; anything less leaves a 1px overflow
  // that shows a horizontal scrollbar at 100%.
  const pageWidth = paneWidth > 0 ? Math.max(240, Math.floor((paneWidth - 36) * zoom)) : undefined;
  const pagePainted = renderedPage === pageNumber;
  const box =
    pagePainted && visibleReveal?.box && visibleReveal.page === pageNumber
      ? rotateBox(visibleReveal.box, rotation)
      : null;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] relative" data-testid="declaration-pdf-pane">
      <div className="h-10 bg-card/80 border-b border-border flex items-center justify-between px-3 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Original form</span>
          <span className="font-arabic text-xs text-muted-foreground/80" dir="rtl">
            الإقرار الأصلي
          </span>
          {visibleReveal && (
            <button
              type="button"
              key={visibleReveal.seq}
              onClick={() => setVisibleReveal(null)}
              title={visibleReveal.box ? 'Unpin' : undefined}
              className="source-reveal-chip font-mono text-[9px] uppercase tracking-widest text-primary bg-primary/10 border border-primary/40 rounded-sm px-1.5 py-0.5 whitespace-nowrap hover:bg-primary/20"
              data-testid="chip-ink-reveal"
            >
              {visibleReveal.box ? `Ink pinned · p.${visibleReveal.page}` : `Page ${visibleReveal.page}`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
            title="Zoom out"
            data-testid="btn-pdf-zoom-out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="font-mono text-[10px] text-muted-foreground w-9 text-center">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(z => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
            title="Zoom in"
            data-testid="btn-pdf-zoom-in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 font-mono text-[10px]"
            onClick={cycleRotation}
            title="Turn the page (scans are often stored sideways)"
            data-testid="btn-pdf-rotate"
          >
            <RotateCw className="h-3.5 w-3.5 mr-1" /> {rotation}°
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
            data-testid="btn-pdf-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-mono text-xs text-foreground tabular-nums" data-testid="text-pdf-page">
            {pageNumber} / {numPages ?? '…'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={numPages === null || pageNumber >= numPages}
            onClick={() => setPageNumber(p => (numPages ? Math.min(numPages, p + 1) : p))}
            data-testid="btn-pdf-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={measureRef} className="flex-1 overflow-auto custom-scrollbar">
        {/* w-max + mx-auto: the sheet centres while it fits and scrolls
            (instead of being clipped) once zoomed wider than the pane. */}
        <div className="p-4 flex w-max min-w-full">
          <div className="relative overflow-hidden shrink-0 mx-auto">
            <Document
              file={`${import.meta.env.BASE_URL}api/cases/${caseId}/disclosure/pdf`}
              onLoadSuccess={({ numPages: n }) => {
                setNumPages(n);
                setPageNumber(p => Math.min(Math.max(1, p), n));
              }}
              loading={<div className="font-mono text-sm text-primary animate-pulse py-20">Loading the scanned form…</div>}
              error={<div className="font-mono text-sm text-destructive py-20">The PDF could not be displayed.</div>}
            >
              <Page
                pageNumber={pageNumber}
                rotate={rotation}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="shadow-2xl border border-border"
                onRenderSuccess={page => {
                  setRenderedPage(page.pageNumber);
                  setPageRenderSeq(s => s + 1);
                }}
              />
            </Document>
            {numPages !== null && !pagePainted && (
              <div
                aria-live="polite"
                className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
                data-testid="status-pdf-rendering"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary bg-background/85 border border-primary/30 rounded-sm px-2 py-1 animate-pulse">
                  Rendering page {pageNumber}…
                </span>
              </div>
            )}
            {visibleReveal && !visibleReveal.box && visibleReveal.page === pageNumber && (
              <div key={visibleReveal.seq} aria-hidden className="source-reveal-flash absolute inset-0 z-10 rounded-sm" />
            )}
            {box && (
              <div
                key={visibleReveal!.seq}
                aria-hidden
                ref={boxRef}
                data-testid="overlay-ink-box"
                className="source-reveal-box absolute z-20"
                style={{
                  left: `${box.x0 * 100}%`,
                  top: `${box.y0 * 100}%`,
                  width: `${(box.x1 - box.x0) * 100}%`,
                  height: `${(box.y1 - box.y0) * 100}%`,
                }}
              >
                <span className="source-reveal-corner corner-tl" />
                <span className="source-reveal-corner corner-tr" />
                <span className="source-reveal-corner corner-bl" />
                <span className="source-reveal-corner corner-br" />
                <ChevronsRight className="source-reveal-arrow h-4 w-4" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
