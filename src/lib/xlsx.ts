/**
 * A small, dependency-free reader for `.xlsx` / `.xlsm` workbooks.
 *
 * An xlsx file is a ZIP of XML parts. The browser gives us everything needed:
 * `DecompressionStream("deflate-raw")` to inflate entries and `DOMParser` to
 * read them — so this avoids pulling in a large spreadsheet library (and its
 * CVE history) for what is a narrow job: get the cells out as strings.
 *
 * Dates are the one subtlety. Excel stores them as serial numbers, so the cell
 * format is read from `styles.xml` and date-formatted cells are emitted as ISO
 * `YYYY-MM-DD`. That also sidesteps day-first/month-first ambiguity entirely
 * for spreadsheets.
 */

export interface Sheet {
  name: string;
  rows: string[][];
}

export interface Workbook {
  sheets: Sheet[];
}

/* --------------------------------------------------------------------- zip */

interface ZipEntry {
  name: string;
  offset: number;
  compressedSize: number;
  method: number;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function listEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Find the End Of Central Directory record, scanning back from the tail.
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (readU32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid zip archive.");

  const count = readU16(view, eocd + 10);
  let pointer = readU32(view, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (readU32(view, pointer) !== 0x02014b50) break;
    const method = readU16(view, pointer + 10);
    const compressedSize = readU32(view, pointer + 20);
    const nameLength = readU16(view, pointer + 28);
    const extraLength = readU16(view, pointer + 30);
    const commentLength = readU16(view, pointer + 32);
    const localOffset = readU32(view, pointer + 42);
    const name = new TextDecoder().decode(
      bytes.subarray(pointer + 46, pointer + 46 + nameLength),
    );

    entries.push({ name, offset: localOffset, compressedSize, method });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function readEntry(
  buffer: ArrayBuffer,
  entry: ZipEntry,
): Promise<string> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The local header repeats the name/extra lengths; data starts after them.
  const nameLength = readU16(view, entry.offset + 26);
  const extraLength = readU16(view, entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  const data = entry.method === 0 ? raw : await inflate(raw);
  return new TextDecoder().decode(data);
}

/* --------------------------------------------------------------------- xml */

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("A part of the workbook could not be read.");
  }
  return doc;
}

/** "BC" -> 54. Column letters are 1-based in the file, 0-based here. */
function columnIndex(reference: string): number {
  const letters = reference.replace(/\d+/g, "");
  let index = 0;
  for (const character of letters) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

/* ------------------------------------------------------------------- dates */

// Built-in numeric formats that represent dates or times.
const DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function looksLikeDateFormat(code: string): boolean {
  // Strip quoted literals and escapes so a literal "d" in text is not counted.
  const bare = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
  return /[dmyh]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

function serialToISO(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  // Excel's 1900 system counts a day that never existed (1900-02-29), which the
  // 1899-12-30 epoch compensates for on all dates after February 1900.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.floor(serial) * 86_400_000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------- the reader */

export async function readWorkbook(file: File): Promise<Workbook> {
  const buffer = await file.arrayBuffer();
  const entries = listEntries(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  const get = async (name: string): Promise<string | null> => {
    const entry = byName.get(name);
    return entry ? readEntry(buffer, entry) : null;
  };

  /* shared strings ------------------------------------------------------- */

  const sharedStrings: string[] = [];
  const sharedXml = await get("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const si of Array.from(parseXml(sharedXml).getElementsByTagName("si"))) {
      // Rich text splits a single string across several <t> runs.
      const parts = Array.from(si.getElementsByTagName("t")).map(
        (t) => t.textContent ?? "",
      );
      sharedStrings.push(parts.join(""));
    }
  }

  /* number formats ------------------------------------------------------- */

  const dateStyles = new Set<number>();
  const stylesXml = await get("xl/styles.xml");
  if (stylesXml) {
    const styles = parseXml(stylesXml);

    const customDateFormats = new Set<number>();
    for (const fmt of Array.from(styles.getElementsByTagName("numFmt"))) {
      const id = Number(fmt.getAttribute("numFmtId"));
      const code = fmt.getAttribute("formatCode") ?? "";
      if (Number.isFinite(id) && looksLikeDateFormat(code)) {
        customDateFormats.add(id);
      }
    }

    const cellXfs = styles.getElementsByTagName("cellXfs")[0];
    const xfs = cellXfs ? Array.from(cellXfs.getElementsByTagName("xf")) : [];
    xfs.forEach((xf, index) => {
      const id = Number(xf.getAttribute("numFmtId"));
      if (DATE_FORMAT_IDS.has(id) || customDateFormats.has(id)) {
        dateStyles.add(index);
      }
    });
  }

  /* workbook / sheet order ----------------------------------------------- */

  const workbookXml = await get("xl/workbook.xml");
  const date1904 = workbookXml
    ? /date1904="(1|true)"/i.test(workbookXml)
    : false;

  const sheetNames: Array<{ name: string; id: string }> = [];
  if (workbookXml) {
    for (const sheet of Array.from(
      parseXml(workbookXml).getElementsByTagName("sheet"),
    )) {
      sheetNames.push({
        name: sheet.getAttribute("name") ?? "Sheet",
        id: sheet.getAttribute("r:id") ?? "",
      });
    }
  }

  const relsXml = await get("xl/_rels/workbook.xml.rels");
  const relTargets = new Map<string, string>();
  if (relsXml) {
    for (const rel of Array.from(
      parseXml(relsXml).getElementsByTagName("Relationship"),
    )) {
      relTargets.set(
        rel.getAttribute("Id") ?? "",
        rel.getAttribute("Target") ?? "",
      );
    }
  }

  /* worksheets ----------------------------------------------------------- */

  const sheetEntryNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();

  const ordered: Array<{ name: string; path: string }> = [];
  for (const [index, sheet] of sheetNames.entries()) {
    const target = relTargets.get(sheet.id) ?? "";
    const path = target
      ? `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`
      : sheetEntryNames[index];
    if (path && byName.has(path)) ordered.push({ name: sheet.name, path });
  }
  // Fall back to file order if the relationships could not be resolved.
  if (ordered.length === 0) {
    sheetEntryNames.forEach((path, index) =>
      ordered.push({ name: `Sheet${index + 1}`, path }),
    );
  }

  const sheets: Sheet[] = [];

  for (const { name, path } of ordered) {
    const xml = await get(path);
    if (!xml) continue;
    const doc = parseXml(xml);
    const rows: string[][] = [];

    for (const rowEl of Array.from(doc.getElementsByTagName("row"))) {
      const cells: string[] = [];
      for (const cell of Array.from(rowEl.getElementsByTagName("c"))) {
        const reference = cell.getAttribute("r") ?? "";
        const index = reference ? columnIndex(reference) : cells.length;
        const type = cell.getAttribute("t");
        const styleIndex = Number(cell.getAttribute("s") ?? "-1");

        let value = "";
        if (type === "inlineStr") {
          value = Array.from(cell.getElementsByTagName("t"))
            .map((t) => t.textContent ?? "")
            .join("");
        } else {
          const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
          if (type === "s") {
            value = sharedStrings[Number(raw)] ?? "";
          } else if (type === "b") {
            value = raw === "1" ? "TRUE" : "FALSE";
          } else if (type === "e") {
            value = "";
          } else if (raw !== "" && dateStyles.has(styleIndex)) {
            value = serialToISO(Number(raw), date1904) ?? raw;
          } else {
            value = raw;
          }
        }

        while (cells.length < index) cells.push("");
        cells[index] = value.trim();
      }
      rows.push(cells);
    }

    // Drop fully blank rows, which spreadsheets accumulate freely.
    sheets.push({
      name,
      rows: rows.filter((row) => row.some((cell) => cell !== "")),
    });
  }

  if (sheets.length === 0) {
    throw new Error("That workbook has no readable sheets.");
  }

  return { sheets };
}

/* ------------------------------------------------------- format detection */

export type SpreadsheetKind = "xlsx" | "legacy-xls" | "html" | "text";

/** Sniffs the real format, because banks routinely mislabel their exports. */
export async function detectKind(file: File): Promise<SpreadsheetKind> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());

  // "PK\x03\x04" — a zip, so a modern Office file.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return "xlsx";
  }
  // OLE2 compound document — genuine legacy BIFF .xls.
  if (
    head[0] === 0xd0 &&
    head[1] === 0xcf &&
    head[2] === 0x11 &&
    head[3] === 0xe0
  ) {
    return "legacy-xls";
  }

  const sample = (await file.slice(0, 4096).text()).toLowerCase();
  if (sample.includes("<table") || sample.includes("<html")) return "html";
  return "text";
}

/**
 * Many Indian bank "`.xls`" downloads are really an HTML table. Reading the
 * first table's rows recovers them without asking the user to convert anything.
 */
export function parseHtmlTable(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = Array.from(doc.getElementsByTagName("table"));
  if (tables.length === 0) return [];

  // Statement pages often wrap the data table in layout tables; the one with
  // the most rows is the data.
  const table = tables.reduce((best, candidate) =>
    candidate.rows.length > best.rows.length ? candidate : best,
  );

  const rows: string[][] = [];
  for (const row of Array.from(table.rows)) {
    const cells = Array.from(row.cells).map((cell) =>
      (cell.textContent ?? "").replace(/ /g, " ").trim(),
    );
    if (cells.some((cell) => cell !== "")) rows.push(cells);
  }
  return rows;
}
