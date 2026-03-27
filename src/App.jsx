import React, { useMemo, useRef, useState } from "react";
import { Camera, FileImage, Trash2, Download, ScanLine, Plus, RefreshCcw } from "lucide-react";
import { jsPDF } from "jspdf";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function processImage(dataUrl) {
  const image = await loadImage(dataUrl);

  const maxWidth = 1800;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context is not available.");
  }

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    const boosted = gray > 170 ? 255 : gray < 90 ? 0 : gray;
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    processed: canvas.toDataURL("image/jpeg", 0.95),
    width,
    height,
  };
}

async function buildPdfBlob(pages) {
  if (!pages.length) return null;

  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let index = 0; index < pages.length; index += 1) {
    if (index > 0) pdf.addPage();

    const img = await loadImage(pages[index].processed);
    const ratio = Math.min(pageWidth / img.width, pageHeight / img.height);
    const renderWidth = img.width * ratio;
    const renderHeight = img.height * ratio;
    const x = (pageWidth - renderWidth) / 2;
    const y = (pageHeight - renderHeight) / 2;

    pdf.addImage(pages[index].processed, "JPEG", x, y, renderWidth, renderHeight, undefined, "FAST");
  }

  return pdf.output("blob");
}

const sanityTestCases = [
  {
    name: "fileToDataUrl exists",
    run: () => typeof fileToDataUrl === "function",
  },
  {
    name: "loadImage exists",
    run: () => typeof loadImage === "function",
  },
  {
    name: "processImage exists",
    run: () => typeof processImage === "function",
  },
  {
    name: "buildPdfBlob exists",
    run: () => typeof buildPdfBlob === "function",
  },
  {
    name: "buildPdfBlob returns null for empty list",
    run: async () => (await buildPdfBlob([])) === null,
  },
];

if (typeof window !== "undefined") {
  sanityTestCases.forEach((testCase) => {
    Promise.resolve(testCase.run()).then((result) => {
      console.assert(result, `Sanity check failed: ${testCase.name}`);
    });
  });
}

function ActionCard({ icon, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[118px] flex-col items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center transition hover:bg-slate-100 active:scale-[0.99]"
    >
      {icon}
      <div className="mt-3 text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
    </button>
  );
}

function PageCard({ page, index, onRemove }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <img src={page.processed} alt={`Stránka ${index + 1}`} className="h-52 w-full object-contain sm:h-60" />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">Stránka {index + 1}</div>
          <div className="text-xs text-slate-500">Připraveno do PDF · můžete přidat další stránku</div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(page.id)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white transition hover:bg-slate-100"
          aria-label={`Smazat stránku ${index + 1}`}
        >
          <Trash2 className="h-4 w-4 text-slate-700" />
        </button>
      </div>
    </div>
  );
}

export default function OnlineScanApp() {
  const pagesSectionRef = useRef(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const [pages, setPages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [downloadReady, setDownloadReady] = useState("");

  const processedCount = pages.length;

  const summary = useMemo(() => {
    if (!processedCount) {
      return "Vyfoťte nebo nahrajte stránky dokumentu. Aplikace je zpracuje a spojí do jednoho PDF.";
    }
    if (processedCount === 1) {
      return "Máte připravenou 1 stránku. Můžete přidat další nebo rovnou stáhnout PDF.";
    }
    return `Máte připravené ${processedCount} stránky. Můžete přidat další nebo rovnou stáhnout PDF.`;
  }, [processedCount]);

  const handleFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;

    setIsProcessing(true);
    setError("");

    try {
      const processedPages = [];
      for (const file of list) {
        const dataUrl = await fileToDataUrl(file);
        const processed = await processImage(dataUrl);
        processedPages.push({
          id: crypto.randomUUID(),
          name: file.name,
          processed: processed.processed,
          width: processed.width,
          height: processed.height,
        });
      }

      setPages((current) => [...current, ...processedPages]);

      requestAnimationFrame(() => {
        setTimeout(() => {
          pagesSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 120);
      });
    } catch (processingError) {
      setError("Nepodařilo se zpracovat obrázky. Zkuste je prosím vyfotit znovu.");
    } finally {
      setIsProcessing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  };

  const removePage = (id) => {
    setPages((current) => current.filter((page) => page.id !== id));
  };

  const clearAll = () => {
    if (downloadReady) {
      URL.revokeObjectURL(downloadReady);
    }
    setDownloadReady("");
    setPages([]);
    setError("");
  };

  const downloadPdf = async () => {
    if (!pages.length) return;

    setIsProcessing(true);
    setError("");

    try {
      const blob = await buildPdfBlob(pages);
      if (!blob) {
        setError("PDF se nepodařilo vytvořit.");
        return;
      }

      const fileName = "online-scan.pdf";
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (typeof navigator !== "undefined" && navigator.canShare && navigator.share) {
        try {
          const canShareFile = navigator.canShare({ files: [file] });
          if (canShareFile) {
            await navigator.share({
              files: [file],
              title: "Online scan",
              text: "Naskenovaný dokument v PDF.",
            });
            return;
          }
        } catch (shareError) {
          // fall through to download fallback
        }
      }

      if (downloadReady) {
        URL.revokeObjectURL(downloadReady);
      }

      const url = URL.createObjectURL(blob);
      setDownloadReady(url);

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (downloadError) {
      setError("PDF se nepodařilo stáhnout. Na telefonu zkuste prosím znovu nebo použijte odkaz Otevřít PDF.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-3 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Online scan</h1>
              <p className="mt-2 max-w-2xl text-slate-600">
                Vyfoťte nebo nahrajte stránky dokumentu. Aplikace je automaticky upraví do scan vzhledu a stáhne jako jedno PDF přímo do zařízení.
              </p>
            </div>

            <div className="w-full max-w-[320px] rounded-3xl bg-slate-50 p-4 md:ml-auto">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">Stav dokumentu</span>
                <span className="font-semibold text-slate-800">{processedCount} stran</span>
              </div>
              <div className="mt-3 h-[3px] rounded-full bg-slate-200">
                <div
                  className="h-[3px] rounded-full bg-slate-900 transition-all duration-300"
                  style={{ width: `${Math.min(100, processedCount * 20)}%` }}
                />
              </div>
              <div className="mt-3 text-sm text-slate-600">{summary}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:gap-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
            <h2 className="mb-5 text-xl font-semibold text-slate-900">Skenování</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <ActionCard
                icon={<Camera className="h-8 w-8 text-slate-800" />}
                title="Skenovat"
                subtitle="Otevře kameru telefonu"
                onClick={() => cameraInputRef.current?.click()}
              />
              <ActionCard
                icon={<FileImage className="h-8 w-8 text-slate-800" />}
                title="Nahrát z galerie"
                subtitle="Vyberte jednu nebo více fotek"
                onClick={() => galleryInputRef.current?.click()}
              />
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <div className="flex items-start gap-3">
                <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-slate-800" />
                <div>
                  Dokument se zpracuje přímo v zařízení. Fotky se nikam neodesílají. Výsledné stránky můžete rovnou spojit do jednoho PDF.
                </div>
              </div>
            </div>

            {error ? <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

            {downloadReady ? (
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                Pokud se PDF nestáhlo automaticky, otevřete ho přes tento odkaz:{" "}
                <a
                  href={downloadReady}
                  download="online-scan.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  Otevřít PDF
                </a>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={!pages.length || isProcessing}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                {isProcessing ? "Zpracovávám…" : "Stáhnout PDF"}
              </button>

              <button
                type="button"
                onClick={clearAll}
                disabled={!pages.length || isProcessing}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCcw className="h-4 w-4" />
                Vymazat vše
              </button>
            </div>
          </div>

          <div ref={pagesSectionRef} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900">Stránky</h2>
              <span className="text-sm text-slate-500">{processedCount} připraveno</span>
            </div>

            {pages.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                Zatím tu nejsou žádné stránky. Začněte tlačítkem <span className="font-medium text-slate-700">Skenovat</span>.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="order-first flex min-h-[200px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center transition hover:bg-slate-100 sm:min-h-[260px]"
                >
                  <Plus className="mb-3 h-8 w-8 text-slate-800" />
                  <div className="text-base font-semibold text-slate-900">Přidat další stránku</div>
                  <div className="mt-1 text-sm text-slate-500">Vyfoťte pokračování dokumentu</div>
                </button>

                {pages.map((page, index) => (
                  <PageCard key={page.id} page={page} index={index} onRemove={removePage} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
