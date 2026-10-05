/**
 * Saves the exact bytes the preview shows, as `fileName` (".pdf" is added if it is missing).
 * Goes through a Blob URL of the same bytes, revoked once the download has started.
 */
export function downloadPdf(data: Uint8Array, fileName: string): void {
  // `slice()` copies into a plain ArrayBuffer, which Blob accepts whatever backed the input.
  const url = URL.createObjectURL(new Blob([data.slice()], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = withPdfExtension(fileName);
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Chrome resolves the Blob URL when the click starts the download; the delay is only a margin.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function withPdfExtension(fileName: string): string {
  const name = fileName.trim() || "document";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
