import { describe, expect, it, vi } from "vitest";
import { readBodyCapped } from "./read-body";

function streamOf(chunks: number[], onCancel = vi.fn()) {
  let i = 0;
  const pulled = { count: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) return controller.close();
      pulled.count += 1;
      controller.enqueue(new Uint8Array(chunks[i++]!).fill(0x61));
    },
    cancel: onCancel,
  });
  return { stream, pulled };
}

describe("readBodyCapped", () => {
  it("reads a body up to the cap, in order", async () => {
    const { stream } = streamOf([3, 4, 3]);
    const read = await readBodyCapped(stream, 10);
    expect(read).toEqual({ ok: true, bytes: new Uint8Array(10).fill(0x61) });
  });

  it("stops at the first byte past the cap, cancels the stream and keeps nothing (a chunked upload with no Content-Length)", async () => {
    const onCancel = vi.fn();
    const { stream, pulled } = streamOf([6, 6, 6, 6, 6], onCancel);
    expect(await readBodyCapped(stream, 10)).toEqual({ ok: false });
    expect(pulled.count).toBe(2);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("no body is an empty one", async () => {
    expect(await readBodyCapped(null, 10)).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });
});
