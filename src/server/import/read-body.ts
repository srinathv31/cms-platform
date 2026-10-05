// A request body read with a byte counter: past `cap` the stream is cancelled and nothing more is
// buffered. A declared Content-Length is only a hint (a chunked request has none), so this is what
// keeps an upload from being held in memory beyond the limit.

export type CappedBody = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false };

export async function readBodyCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<CappedBody> {
  if (!body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, bytes };
}
