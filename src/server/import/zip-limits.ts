// A .docx's zip, checked from its central directory before anything is inflated: how many entries,
// and how large they say they are once inflated. A file over these limits is refused as unreadable
// without being opened. The sizes are the file's own claims: a zip that understates them is caught
// later by the conversion worker's heap limit (isolate.ts), not here.

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxRatio: number;
  ratioFloorBytes: number;
}

export const ZIP_LIMITS: Readonly<ZipLimits> = {
  /** A Word document has a few dozen parts; thousands means something else. */
  maxEntries: 2_000,
  /** One part, inflated (document.xml for 200,000 characters of heavily formatted text is far less). */
  maxEntryBytes: 48 * 1024 * 1024,
  /** Every part together, inflated. */
  maxTotalBytes: 96 * 1024 * 1024,
  /** Inflated ÷ compressed, for the whole file, once the inflated total is past `ratioFloorBytes`. */
  maxRatio: 100,
  ratioFloorBytes: 16 * 1024 * 1024,
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export type ZipCheck = { ok: true; entries: number; totalBytes: number } | { ok: false; why: string };

/** Reads the central directory and checks it against ZIP_LIMITS. Zip64 is refused (a docx under 10 MB never needs it). */
export function checkZip(bytes: Uint8Array, limits: Readonly<ZipLimits> = ZIP_LIMITS): ZipCheck {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: 22 bytes plus a comment of up to 64 KB, at the end.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, why: "no end of central directory" };

  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return { ok: false, why: "zip64" };
  if (count > limits.maxEntries) return { ok: false, why: `${count} entries` };
  if (offset + size > eocd) return { ok: false, why: "central directory out of bounds" };

  let at = offset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL) return { ok: false, why: "broken central directory" };
    const inflated = view.getUint32(at + 24, true);
    if (inflated === 0xffffffff) return { ok: false, why: "zip64" };
    if (inflated > limits.maxEntryBytes) return { ok: false, why: `an entry of ${inflated} bytes` };
    total += inflated;
    if (total > limits.maxTotalBytes) return { ok: false, why: `${total}+ bytes inflated` };
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (total > limits.ratioFloorBytes && total / bytes.length > limits.maxRatio) {
    return { ok: false, why: `inflates ${Math.round(total / bytes.length)}×` };
  }
  return { ok: true, entries: count, totalBytes: total };
}
