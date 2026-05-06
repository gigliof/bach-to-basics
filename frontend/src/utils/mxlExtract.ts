/**
 * Browser-side .mxl extractor.
 *
 * .mxl (compressed MusicXML) is a ZIP archive containing:
 *   META-INF/container.xml  — lists the root MusicXML file
 *   <root>.xml              — the actual MusicXML document
 *
 * We parse the ZIP central directory to locate files, then decompress each
 * DEFLATE-compressed entry with the browser-native DecompressionStream API
 * (available in Chrome 80+, Firefox 113+, Safari 16.4+).
 *
 * Why not rely on AlphaTab's built-in .mxl support?
 * AlphaTab's MusicXmlImporter can parse .mxl, but it runs synchronously inside
 * a try/catch; if its ZIP reader or XML parser chokes on any detail of this
 * specific file (e.g. MuseScore 2 export quirks) the error is swallowed and
 * the sheet view silently stays blank.  Extracting ourselves gives us a plain
 * XML string that takes the battle-tested string path in SheetMusicView.
 */

const SIG_LOCAL   = 0x04034b50; // PK\x03\x04
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02
const SIG_EOCD    = 0x06054b50; // PK\x05\x06

interface ZipEntry {
  name: string;
  localOffset: number;
}

/** Scan for the End-of-Central-Directory record (last PK\x05\x06 in the file). */
function findEocd(bytes: Uint8Array): number {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (
      bytes[i]     === 0x50 && bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06
    ) return i;
  }
  return -1;
}

/** Read central-directory entries to build a name→localOffset map. */
function readCentralDirectory(view: DataView, bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(bytes);
  if (eocd === -1) throw new Error("Not a ZIP archive");

  if (view.getUint32(eocd, true) !== SIG_EOCD) throw new Error("Bad EOCD signature");

  const numEntries = view.getUint16(eocd + 10, true);
  let cdPos        = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < numEntries; i++) {
    if (view.getUint32(cdPos, true) !== SIG_CENTRAL) break;

    const fileNameLen  = view.getUint16(cdPos + 28, true);
    const extraLen     = view.getUint16(cdPos + 30, true);
    const commentLen   = view.getUint16(cdPos + 32, true);
    const localOffset  = view.getUint32(cdPos + 42, true);
    const name         = new TextDecoder().decode(bytes.slice(cdPos + 46, cdPos + 46 + fileNameLen));
    entries.push({ name, localOffset });
    cdPos += 46 + fileNameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompress one local-file entry, returning its raw bytes. */
async function readLocalEntry(
  view: DataView,
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const off = entry.localOffset;
  if (view.getUint32(off, true) !== SIG_LOCAL) {
    throw new Error(`Bad local header at offset ${off}`);
  }

  const compressionMethod = view.getUint16(off + 8,  true);
  const compressedSize    = view.getUint32(off + 18, true);
  const fileNameLen       = view.getUint16(off + 26, true);
  const extraLen          = view.getUint16(off + 28, true);
  const dataStart         = off + 30 + fileNameLen + extraLen;

  const compressed = bytes.slice(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    // Stored — no compression
    return compressed;
  }
  if (compressionMethod !== 8) {
    throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
  }

  // DEFLATE (raw, no zlib header) — decompress with browser-native stream.
  // Cap decompressed size to 50 MB to prevent ZIP-bomb attacks: a crafted
  // .mxl with a tiny compressed payload that expands to gigabytes would
  // otherwise freeze or crash the browser tab.
  const MAX_DECOMPRESSED = 50 * 1024 * 1024; // 50 MB - largest real scores are <5 MB

  const ds     = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(compressed);
  writer.close();

  const chunks: Uint8Array[] = [];
  let totalDecompressed = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalDecompressed += value.length;
    if (totalDecompressed > MAX_DECOMPRESSED) {
      throw new Error("Decompressed MusicXML exceeds 50 MB — possible ZIP bomb");
    }
    chunks.push(value);
  }

  const total  = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let cursor   = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

/**
 * Extract the MusicXML string from a .mxl (ZIP-compressed MusicXML) ArrayBuffer.
 * Throws if the archive is malformed or missing required files.
 */
export async function extractXmlFromMxl(buffer: ArrayBuffer): Promise<string> {
  const bytes   = new Uint8Array(buffer);
  const view    = new DataView(buffer);
  const entries = readCentralDirectory(view, bytes);

  const find = (name: string) => entries.find(e => e.name === name);

  // 1. Read META-INF/container.xml
  const containerEntry = find("META-INF/container.xml");
  if (!containerEntry) throw new Error("Not a valid .mxl file: missing META-INF/container.xml");

  const containerBytes = await readLocalEntry(view, bytes, containerEntry);
  const containerXml   = new TextDecoder("utf-8").decode(containerBytes);

  // 2. Parse the root-file path (e.g. full-path="score.xml")
  const match = containerXml.match(/full-path="([^"]+)"/);
  if (!match) throw new Error('Malformed container.xml: no full-path attribute');
  const rootPath = match[1];

  // 3. Read the root MusicXML entry
  const rootEntry = find(rootPath);
  if (!rootEntry) throw new Error(`Root file "${rootPath}" not found in .mxl archive`);

  const xmlBytes = await readLocalEntry(view, bytes, rootEntry);
  return new TextDecoder("utf-8").decode(xmlBytes);
}
