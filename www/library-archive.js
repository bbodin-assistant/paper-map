import { paperToBibTeX, parseBibTeX } from "./import-export.js";

const ARCHIVE_VERSION = 3;
const PREVIOUS_ARCHIVE_VERSION = 2;
const LEGACY_ARCHIVE_VERSION = 1;
const BIB_FILENAME = "library.bib";
const METADATA_FILENAME = "metadata.json";
const UTF8_FLAG = 0x0800;
const ZIP_STORE = 0;
const ZIP_DEFLATE = 8;
const MAX_ZIP32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function cleanArchiveKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
}

function defaultArchiveKey(paper, index) {
  const author = String(paper?.authors?.[0] || "paper").trim().split(/\s+/).at(-1) || "paper";
  const title = String(paper?.title || "").trim().split(/\s+/).slice(0, 4).join("-");
  return cleanArchiveKey([author, paper?.year || "", title].filter(Boolean).join("-")) || "paper-" + (index + 1);
}

export function assignArchiveKeys(papers = []) {
  const used = new Set();
  return papers.map((paper, index) => {
    const base = cleanArchiveKey(paper?.citationKey) || defaultArchiveKey(paper, index);
    let key = base;
    let suffix = 2;
    while (used.has(key.toLowerCase())) {
      key = base.slice(0, Math.max(1, 78 - String(suffix).length)) + "-" + suffix;
      suffix += 1;
    }
    used.add(key.toLowerCase());
    return { key, paper };
  });
}

function base64UrlToBytes(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function attachmentMetadata(entry) {
  const metadata = entry?.metadata || {};
  const result = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "blob" || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

export function libraryToArchiveBibTeX(library, pdfEntries = []) {
  const keyedPapers = assignArchiveKeys(library?.papers || []);
  const pdfByPaperId = new Map((pdfEntries || []).map((entry) => [entry.paperId, entry]));
  const attachments = [];

  for (const { key, paper } of keyedPapers) {
    const entry = pdfByPaperId.get(paper.id);
    if (!entry?.blob) continue;
    attachments.push({
      key,
      paperId: paper.id,
      metadata: attachmentMetadata(entry),
    });
  }

  const payload = {
    archiveVersion: ARCHIVE_VERSION,
    schemaVersion: Number(library?.schemaVersion || 1),
    exportedAt: new Date().toISOString(),
    papers: keyedPapers.map(({ key, paper }) => ({ key, paper })),
    edges: library?.edges || [],
    topics: library?.topics || [],
    meta: library?.meta || {},
    attachments,
  };

  const entries = keyedPapers.map(({ key, paper }) => paperToBibTeX({ ...paper, citationKey: key }));
  const bibtex = entries.join("\n\n") + (entries.length ? "\n" : "");
  const metadataJson = JSON.stringify(payload, null, 2) + "\n";
  return { bibtex, metadataJson, keyedPapers, payload };
}

function validateArchivePayload(payload, bibtex, expectedVersion) {
  if (!payload || Number(payload.archiveVersion) !== expectedVersion || !Array.isArray(payload.papers)) {
    throw new Error("Paper Map archive metadata has an unsupported structure.");
  }
  if (!Array.isArray(payload.edges) || !Array.isArray(payload.topics) || !payload.meta || typeof payload.meta !== "object") {
    throw new Error("Paper Map archive metadata is missing database collections.");
  }

  const keySet = new Set();
  for (const item of payload.papers) {
    const key = cleanArchiveKey(item?.key);
    if (!key || key !== item.key || !item.paper || typeof item.paper !== "object") {
      throw new Error("Paper Map archive contains an invalid citation key.");
    }
    if (keySet.has(key.toLowerCase())) throw new Error("Paper Map archive contains duplicate citation keys.");
    keySet.add(key.toLowerCase());
  }

  if (bibtex !== null && bibtex !== undefined) {
    const visibleKeys = new Set(parseBibTeX(bibtex).map((paper) => paper.citationKey));
    for (const item of payload.papers) {
      if (!visibleKeys.has(item.key)) {
        throw new Error("Paper Map archive metadata does not match the BibTeX entry " + item.key + ".");
      }
    }
  }
  return payload;
}

function parseArchiveMetadataJson(bytes, bibtex) {
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("Paper Map metadata.json is invalid: " + (error?.message || error));
  }
  const version = Number(payload?.archiveVersion);
  if (![ARCHIVE_VERSION, PREVIOUS_ARCHIVE_VERSION].includes(version)) {
    throw new Error("Unsupported Paper Map archive version: " + String(payload?.archiveVersion ?? "missing") + ".");
  }
  if (version === PREVIOUS_ARCHIVE_VERSION && (bibtex === null || bibtex === undefined)) {
    throw new Error("This version 2 Paper Map archive requires library.bib.");
  }
  return validateArchivePayload(payload, bibtex, version);
}

function parseLegacyArchiveMetadata(bibtex) {
  const versionMatch = String(bibtex || "").match(/^%\s*PaperMap-Archive-Version:\s*(\d+)\s*$/im);
  if (!versionMatch) {
    throw new Error("Paper Map archive must contain metadata.json at the ZIP root.");
  }
  if (Number(versionMatch[1]) !== LEGACY_ARCHIVE_VERSION) {
    throw new Error("Unsupported Paper Map archive version: " + versionMatch[1] + ".");
  }

  const chunks = [];
  for (const line of String(bibtex || "").split(/\r?\n/)) {
    const match = line.match(/^%\s*PaperMap-Metadata:\s*([A-Za-z0-9_-]+)\s*$/);
    if (match) chunks.push(match[1]);
  }
  if (!chunks.length) throw new Error("Legacy Paper Map archive metadata is missing from library.bib.");

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(chunks.join(""))));
  } catch (error) {
    throw new Error("Legacy Paper Map archive metadata is invalid: " + (error?.message || error));
  }
  return validateArchivePayload(payload, bibtex, LEGACY_ARCHIVE_VERSION);
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: ((hours << 11) | (minutes << 5) | seconds) & 0xffff,
    date: (((year - 1980) << 9) | (month << 5) | day) & 0xffff,
  };
}

async function toBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new Error("Unsupported ZIP entry content.");
}

function uint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ZIP32) {
    throw new Error(label + " exceeds the 4 GiB ZIP32 archive limit.");
  }
  return value;
}

function localHeader(nameBytes, bytes, crc, offsetDate) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE, true);
  view.setUint16(10, offsetDate.time, true);
  view.setUint16(12, offsetDate.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, uint32(bytes.length, "ZIP entry size"), true);
  view.setUint32(22, uint32(bytes.length, "ZIP entry size"), true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function centralHeader(nameBytes, bytes, crc, localOffset, offsetDate) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE, true);
  view.setUint16(12, offsetDate.time, true);
  view.setUint16(14, offsetDate.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, uint32(bytes.length, "ZIP entry size"), true);
  view.setUint32(24, uint32(bytes.length, "ZIP entry size"), true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, uint32(localOffset, "ZIP entry offset"), true);
  header.set(nameBytes, 46);
  return header;
}

async function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    if (!nameBytes.length || nameBytes.length > 0xffff) throw new Error("ZIP entry name is invalid.");
    const bytes = await toBytes(entry.content);
    const crc = crc32(bytes);
    const local = localHeader(nameBytes, bytes, crc, stamp);
    chunks.push(local, bytes);
    central.push(centralHeader(nameBytes, bytes, crc, offset, stamp));
    offset = uint32(offset + local.length + bytes.length, "ZIP archive size");
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  if (central.length > 0xffff) throw new Error("ZIP archive contains too many files.");
  uint32(centralSize, "ZIP central directory size");
  uint32(centralOffset, "ZIP central directory offset");

  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, central.length, true);
  view.setUint16(10, central.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This ZIP uses DEFLATE compression, which this browser cannot decompress.");
  }
  let stream;
  try {
    stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  } catch (error) {
    throw new Error("This browser cannot decompress DEFLATE ZIP entries: " + (error?.message || error));
  }
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65557);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 22) throw new Error("ZIP archive is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  if (endOffset < 0) throw new Error("ZIP central directory was not found.");

  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (centralOffset + centralSize > bytes.length) throw new Error("ZIP central directory is truncated.");

  const files = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is invalid.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > bytes.length) throw new Error("ZIP central directory entry is truncated.");
    if (flags & 0x0001) throw new Error("Encrypted ZIP entries are not supported.");

    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || files.has(name)) throw new Error("ZIP archive contains an invalid or duplicate filename.");
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("ZIP local file header is invalid for " + name + ".");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > bytes.length) throw new Error("ZIP file data is truncated for " + name + ".");

    const compressed = bytes.subarray(dataOffset, dataEnd);
    let content;
    if (method === ZIP_STORE) content = new Uint8Array(compressed);
    else if (method === ZIP_DEFLATE) content = await inflateRaw(compressed);
    else throw new Error("Unsupported ZIP compression method " + method + " for " + name + ".");

    if (content.length !== uncompressedSize) throw new Error("ZIP entry size check failed for " + name + ".");
    if (crc32(content) !== expectedCrc) throw new Error("ZIP CRC check failed for " + name + ".");
    files.set(name, content);
    cursor = entryEnd;
  }
  return files;
}

function isPdf(bytes) {
  return bytes?.length >= 4
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46;
}

export async function createLibraryArchive(library, pdfEntries = []) {
  const { bibtex, metadataJson, keyedPapers } = libraryToArchiveBibTeX(library, pdfEntries);
  const pdfByPaperId = new Map((pdfEntries || []).map((entry) => [entry.paperId, entry]));
  const entries = [{ name: METADATA_FILENAME, content: metadataJson }];

  for (const { key, paper } of keyedPapers) {
    entries.push({
      name: "papers/" + key + ".json",
      content: JSON.stringify({ schemaVersion: 1, paper }, null, 2) + "\n",
    });
  }

  for (const { key, paper } of keyedPapers) {
    const entry = pdfByPaperId.get(paper.id);
    if (!entry?.blob) continue;
    entries.push({ name: key + ".pdf", content: entry.blob });
  }
  return createZip(entries);
}

export async function parseLibraryArchive(buffer) {
  const files = await readZip(buffer);
  const bibName = Array.from(files.keys()).find((name) => name.toLowerCase() === BIB_FILENAME);
  const metadataName = Array.from(files.keys()).find((name) => name.toLowerCase() === METADATA_FILENAME);
  const bibtex = bibName ? new TextDecoder().decode(files.get(bibName)) : null;
  if (!metadataName && !bibName) {
    throw new Error("Paper Map archive must contain metadata.json at the ZIP root.");
  }
  const payload = metadataName
    ? parseArchiveMetadataJson(files.get(metadataName), bibtex)
    : parseLegacyArchiveMetadata(bibtex);
  const keyedPapers = payload.papers.map(({ key, paper }) => ({ key, paper }));
  const attachmentMeta = new Map((payload.attachments || []).map((item) => [item.key, item]));
  const knownPdfNames = new Set(keyedPapers.map(({ key }) => key + ".pdf"));

  for (const name of files.keys()) {
    if (/\.pdf$/i.test(name) && !knownPdfNames.has(name)) {
      throw new Error("PDF filename does not match a paper key in the archive metadata: " + name + ".");
    }
  }

  const pdfs = [];
  for (const { key, paper } of keyedPapers) {
    const name = key + ".pdf";
    const bytes = files.get(name);
    if (!bytes) continue;
    if (!isPdf(bytes)) throw new Error(name + " is not a PDF file.");
    const archived = attachmentMeta.get(key);
    pdfs.push({
      key,
      archiveName: name,
      paperId: paper.id,
      metadata: archived?.metadata || {},
      blob: new Blob([bytes], { type: "application/pdf" }),
    });
  }

  return {
    library: {
      schemaVersion: Number(payload.schemaVersion || 1),
      papers: keyedPapers.map(({ paper }) => paper),
      edges: payload.edges,
      topics: payload.topics,
      meta: payload.meta,
    },
    keyedPapers,
    pdfs,
    bibtex: bibtex || "",
  };
}
