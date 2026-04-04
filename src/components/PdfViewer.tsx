import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Props {
  src: string;
}

export default function PdfViewer({ src }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the PDF document
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);
        const doc = await pdfjsLib.getDocument(src).promise;
        if (!cancelled) {
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          setCurrentPage(1);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load the PDF document. Please try again.");
          console.error("PDF load error:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Render the current page
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      // Cancel any in-progress render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });

      renderTaskRef.current = renderTask;
      await renderTask.promise;
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "RenderingCancelledException") {
        console.error("Page render error:", err);
      }
    }
  }, [pdfDoc, currentPage, scale]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Fit to container width on initial load
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;

    async function fitWidth() {
      const page = await pdfDoc!.getPage(1);
      const viewport = page.getViewport({ scale: 1.0 });
      const containerWidth = containerRef.current!.clientWidth;
      const fitScale = Math.min(containerWidth / viewport.width, 2.0);
      setScale(Math.round(fitScale * 100) / 100);
    }

    fitWidth();
  }, [pdfDoc]);

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3.0));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const prevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const nextPage = () => setCurrentPage((p) => Math.min(p + 1, totalPages));

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg
          className="w-16 h-16 text-red-400 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
        <p className="text-[--color-slate] text-lg mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-[--color-primary] text-[--color-cream] rounded-lg hover:bg-[--color-primary-light] transition-colors font-semibold text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-10 h-10 border-4 border-[--color-primary]/20 border-t-[--color-primary] rounded-full animate-spin mb-4" />
        <p className="text-[--color-slate-light] text-sm">Loading document...</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col items-center">
      {/* Controls */}
      <div className="sticky top-16 z-10 w-full bg-white/95 backdrop-blur-sm border-b border-[--color-cream-dark] py-3 px-4 flex flex-wrap items-center justify-center gap-3 mb-4">
        {/* Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevPage}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            className="p-2 rounded-lg border border-[--color-cream-dark] hover:bg-[--color-cream] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-[--color-slate] min-w-[5rem] text-center">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={nextPage}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
            className="p-2 rounded-lg border border-[--color-cream-dark] hover:bg-[--color-cream] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 border-l border-[--color-cream-dark] pl-3">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            aria-label="Zoom out"
            className="p-2 rounded-lg border border-[--color-cream-dark] hover:bg-[--color-cream] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <span className="text-sm text-[--color-slate] min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 3.0}
            aria-label="Zoom in"
            className="p-2 rounded-lg border border-[--color-cream-dark] hover:bg-[--color-cream] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="overflow-auto max-w-full pb-8">
        <canvas
          ref={canvasRef}
          className="shadow-lg rounded border border-[--color-cream-dark]"
        />
      </div>
    </div>
  );
}
