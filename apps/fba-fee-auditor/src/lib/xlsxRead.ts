// Minimal .xlsx reader: enough to turn Amazon's report downloads into rows.
//
// An .xlsx is a ZIP of XML. Rather than pull in a spreadsheet library for what
// is always a flat export, we unzip with node's own inflate and read the two
// parts that matter: the first worksheet, and the shared-string table its cells
// point into. Styles, formulas, merged cells and dates-as-numbers are ignored —
// every value comes back as the text Excel stored.
//
// Server-side only (node:zlib).

import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** Walk the ZIP central directory. Returns every entry, uncompressed lazily. */
function readCentralDirectory(buf: Buffer): ZipEntry[] {
  // The end-of-central-directory record sits at the tail, after a comment of
  // unknown length, so scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no ZIP directory found).");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    entries.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
      method,
      compressedSize,
      localHeaderOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry. The local header repeats the name/extra lengths, and
 *  those are the authoritative ones — the central copy can disagree. */
function readEntry(buf: Buffer, e: ZipEntry): string {
  const p = e.localHeaderOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`Corrupt entry ${e.name}`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw.toString("utf8");
  if (e.method === 8) return inflateRawSync(raw).toString("utf8");
  throw new Error(`Unsupported ZIP compression (method ${e.method}) in ${e.name}`);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" survives as "&lt;"
}

/** Shared strings, in index order. A string can be split across <r> runs. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? []) {
    let text = "";
    for (const t of si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []) {
      text += unescapeXml(t.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, ""));
    }
    out.push(text);
  }
  return out;
}

/** "BC12" -> 54 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const cellXml of rowXml.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cellXml)?.[1];
      const type = /\bt="([^"]+)"/.exec(cellXml)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        for (const t of cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []) {
          value += unescapeXml(t.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, ""));
        }
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
        if (raw != null) {
          value = type === "s" ? (shared[Number(raw)] ?? "") : unescapeXml(raw);
        }
      }
      // Honour the cell reference so blank cells keep their column position.
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** True when these bytes look like a ZIP container (so: .xlsx, not text). */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
}

/**
 * Read the first worksheet of an .xlsx as rows of strings. Trailing empty
 * columns are kept so a row's cells line up with the header row.
 */
export function readXlsx(buf: Buffer): string[][] {
  const entries = readCentralDirectory(buf);
  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => {
      const n = (s: string) => Number(/sheet(\d+)\.xml$/.exec(s)?.[1] ?? 0);
      return n(a.name) - n(b.name);
    });
  if (sheets.length === 0) throw new Error("That .xlsx has no worksheets.");

  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(readEntry(buf, sharedEntry)) : [];
  return parseSheet(readEntry(buf, sheets[0]), shared);
}
