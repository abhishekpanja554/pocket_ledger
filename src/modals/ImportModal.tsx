import { CheckCircle2, FileSpreadsheet, FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { TransactionInput } from "../../shared/types";
import { Field, Modal, Notice, Spinner, useFileDrop } from "../components/ui";
import {
  COLUMN_ROLE_LABELS,
  findHeaderRow,
  guessMapping,
  mappingIsComplete,
  parseCsv,
  parseCsvDate,
  rowsToTransactions,
  type ColumnMapping,
  type ColumnRole,
} from "../lib/csv";
import { formatBytes, formatDate } from "../lib/format";
import {
  detectKind,
  parseHtmlTable,
  readWorkbook,
  type Sheet,
} from "../lib/xlsx";
import { usePocketLedger } from "../store";

type Tab = "csv" | "documents";
type Stage = "choose" | "map" | "result";

interface ImportSummary {
  inserted: number;
  duplicates: number;
  skipped: number;
  needsReview: number;
  errors: string[];
  filesStored: number;
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("csv");

  return (
    <Modal
      title="Import"
      subtitle="Bring in a statement or spreadsheet, or store receipts and other documents."
      onClose={onClose}
      wide
    >
      <div className="segmented" role="tablist" aria-label="Import type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "csv"}
          aria-pressed={tab === "csv"}
          onClick={() => setTab("csv")}
        >
          Statement / spreadsheet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "documents"}
          aria-pressed={tab === "documents"}
          onClick={() => setTab("documents")}
        >
          Documents
        </button>
      </div>

      {tab === "csv" ? (
        <CsvImport onClose={onClose} />
      ) : (
        <DocumentImport onClose={onClose} />
      )}
    </Modal>
  );
}

/* ==================================================================== CSV */

function CsvImport({ onClose }: { onClose: () => void }) {
  const { state, addTransactions, uploadDocuments, notify } = usePocketLedger();
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [storeOriginal, setStoreOriginal] = useState(true);
  const [dayFirst, setDayFirst] = useState(true);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [skippedPreamble, setSkippedPreamble] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const accounts = state?.settings.accounts ?? [];
  const [fallbackAccount, setFallbackAccount] = useState(
    accounts[0] ?? "Imported account",
  );

  const { isDragging, dropProps } = useFileDrop((files) =>
    void onFileChosen(files[0] ?? null),
  );

  /** Turns a parsed grid into the mapping step, finding the real header row. */
  function loadGrid(parsed: string[][], sourceLabel: string) {
    if (parsed.length === 0) {
      setError(`${sourceLabel} has no readable rows.`);
      return;
    }

    const { index, hasHeader } = findHeaderRow(parsed);
    setHasHeaderRow(hasHeader);
    setSkippedPreamble(hasHeader ? index : 0);

    const headerCells = hasHeader
      ? parsed[index]
      : parsed[0].map((_, i) => `Column ${i + 1}`);

    setHeaders(headerCells);
    setRows(hasHeader ? parsed.slice(index + 1) : parsed);
    setMapping(guessMapping(headerCells));
    setStage("map");
  }

  async function onFileChosen(chosen: File | null) {
    setError(null);
    setSheets([]);
    if (!chosen) return;
    if (chosen.size > 20 * 1024 * 1024) {
      setError(`${chosen.name} is larger than the 20 MB limit.`);
      return;
    }
    setFile(chosen);

    try {
      const kind = await detectKind(chosen);

      if (kind === "legacy-xls") {
        setError(
          `${chosen.name} is in the old Excel 97–2003 format, which Pocket Ledger cannot read directly. Open it and use File → Save As → “Excel Workbook (.xlsx)” or “CSV UTF-8”, then import that.`,
        );
        return;
      }

      if (kind === "xlsx") {
        const workbook = await readWorkbook(chosen);
        const withData = workbook.sheets.filter((sheet) => sheet.rows.length > 0);
        if (withData.length === 0) {
          setError(`${chosen.name} has no rows in any sheet.`);
          return;
        }
        setSheets(withData);
        setActiveSheet(withData[0].name);
        loadGrid(withData[0].rows, `Sheet “${withData[0].name}”`);
        return;
      }

      const text = await chosen.text();
      // Some bank downloads are an HTML table wearing a spreadsheet extension.
      const parsed = kind === "html" ? parseHtmlTable(text) : parseCsv(text);
      loadGrid(parsed, chosen.name);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${chosen.name} could not be read. ${err.message}`
          : `${chosen.name} could not be read.`,
      );
    }
  }

  function chooseSheet(name: string) {
    const sheet = sheets.find((s) => s.name === name);
    if (!sheet) return;
    setActiveSheet(name);
    setError(null);
    loadGrid(sheet.rows, `Sheet “${name}”`);
  }

  async function runImport() {
    if (!mappingIsComplete(mapping)) {
      setError(
        "Map a date column, a merchant column, and at least one amount column before importing.",
      );
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const converted = rowsToTransactions(rows, mapping, {
        knownCategories: state?.settings.categories ?? [],
        fallbackAccount,
        dayFirst,
      });

      if (converted.transactions.length === 0) {
        setError(
          "No rows could be read with that mapping. Nothing was imported.",
        );
        setBusy(false);
        return;
      }

      const result = await addTransactions(
        converted.transactions as TransactionInput[],
        { applyRules: true },
      );

      let filesStored = 0;
      if (storeOriginal && file) {
        const upload = await uploadDocuments([file], "stored");
        filesStored = upload.documents.length;
        if (upload.errors.length) result.errors.push(...upload.errors);
      }

      setSummary({
        inserted: result.inserted,
        duplicates: result.duplicates,
        skipped: result.skipped + converted.unparseable,
        needsReview: result.needsReview,
        errors: result.errors,
        filesStored,
      });
      setStage("result");
      notify(
        `Import finished: ${result.inserted} added, ${result.duplicates} duplicates skipped.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The import could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (stage === "result" && summary) {
    return (
      <div className="stack">
        <Notice kind="success">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Import complete.</span>
        </Notice>
        <div className="card card--pad">
          <ResultLine label="Transactions added" value={summary.inserted} />
          <ResultLine label="Duplicates skipped" value={summary.duplicates} />
          <ResultLine label="Rows skipped" value={summary.skipped} />
          <ResultLine label="Needs review" value={summary.needsReview} />
          <ResultLine label="Original files stored" value={summary.filesStored} />
        </div>
        {summary.errors.length ? (
          <div className="stack" style={{ gap: 6 }}>
            <p className="field__label">
              Details ({summary.errors.length})
            </p>
            <div className="scroll-list">
              {summary.errors.map((message, index) => (
                <p className="field__hint" key={index}>
                  {message}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <div className="row row--between">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStage("choose");
              setSummary(null);
              setFile(null);
              setRows([]);
            }}
          >
            Import another file
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (stage === "map") {
    const complete = mappingIsComplete(mapping);
    const dateColumn = Object.entries(mapping).find(([, role]) => role === "date");
    const dateSample = dateColumn
      ? rows.map((row) => row[Number(dateColumn[0])]).find((cell) => cell?.trim())
      : undefined;
    return (
      <div className="stack">
        <p className="page-intro">
          Pocket Ledger detected {headers.length} columns and {rows.length} data rows in{" "}
          <strong>{file?.name}</strong>
          {sheets.length > 0 ? <> · sheet “{activeSheet}”</> : null}. Confirm what
          each column means — nothing is guessed silently.
        </p>

        {error ? <Notice kind="error">{error}</Notice> : null}

        {sheets.length > 1 ? (
          <Field
            label="Sheet"
            hint="This workbook has more than one sheet with data."
          >
            <select
              className="select"
              value={activeSheet}
              onChange={(event) => chooseSheet(event.target.value)}
            >
              {sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name} ({sheet.rows.length} rows)
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {skippedPreamble > 0 ? (
          <Notice kind="info">
            Skipped {skippedPreamble} heading row
            {skippedPreamble === 1 ? "" : "s"} above the column names.
          </Notice>
        ) : null}

        <div className="stack" style={{ gap: 10 }}>
          {headers.map((header, index) => (
            <div className="row" key={index} style={{ gap: 10, flexWrap: "nowrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="list-row__title">{header || `Column ${index + 1}`}</p>
                <p className="cell-meta">
                  {rows
                    .slice(0, 2)
                    .map((row) => row[index])
                    .filter(Boolean)
                    .join("  ·  ") || "No sample values"}
                </p>
              </div>
              <select
                className="select"
                style={{ maxWidth: 220 }}
                aria-label={`Meaning of column ${header || index + 1}`}
                value={mapping[index] ?? "ignore"}
                onChange={(event) =>
                  setMapping((current) => ({
                    ...current,
                    [index]: event.target.value as ColumnRole,
                  }))
                }
              >
                {COLUMN_ROLE_LABELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {!hasHeaderRow ? (
          <Notice kind="info">
            No header row was detected, so the first line is treated as data.
          </Notice>
        ) : null}

        <Field
          label="Date order"
          hint={
            dateSample
              ? `“${dateSample}” will be read as ${
                  parseCsvDate(dateSample, dayFirst)
                    ? formatDate(parseCsvDate(dateSample, dayFirst) as string)
                    : "an unreadable date"
                }.`
              : "Indian statements are normally day first."
          }
        >
          <div className="segmented" role="group" aria-label="Date order">
            <button
              type="button"
              aria-pressed={dayFirst}
              onClick={() => setDayFirst(true)}
            >
              Day first (DD/MM)
            </button>
            <button
              type="button"
              aria-pressed={!dayFirst}
              onClick={() => setDayFirst(false)}
            >
              Month first (MM/DD)
            </button>
          </div>
        </Field>

        <Field
          label="Account for rows without one"
          hint="Used only when the statement has no account column."
        >
          <select
            className="select"
            value={fallbackAccount}
            onChange={(event) => setFallbackAccount(event.target.value)}
          >
            {(accounts.length ? accounts : ["Imported account"]).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={storeOriginal}
            onChange={(event) => setStoreOriginal(event.target.checked)}
          />
          Also keep the original file in Documents
        </label>

        <div className="row row--between">
          <button
            type="button"
            className="btn"
            onClick={() => setStage("choose")}
            disabled={busy}
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void runImport()}
            disabled={busy || !complete}
          >
            {busy ? <Spinner label="Importing" /> : `Import ${rows.length} rows`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="page-intro">
        Choose a bank or card statement — <strong>CSV</strong> or an{" "}
        <strong>Excel .xlsx</strong> workbook. Pocket Ledger finds the real header
        row itself, so account details and blank lines above it are fine. It
        reads real rows only: lines it cannot parse are reported, never invented,
        and duplicates are skipped automatically.
      </p>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div
        className={`drop-zone ${isDragging ? "drop-zone--active" : ""}`}
        style={{ padding: 4 }}
        {...dropProps}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => void onFileChosen(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => fileRef.current?.click()}
        >
          <FileSpreadsheet size={17} aria-hidden="true" />
          Choose a file, or drag one here
        </button>
      </div>
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-line">
      <span className="stat-line__label">{label}</span>
      <span className="stat-line__value">{value}</span>
    </div>
  );
}

/* ============================================================== documents */

function DocumentImport({ onClose }: { onClose: () => void }) {
  const { uploadDocuments, notify } = usePocketLedger();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<number | null>(null);

  const { isDragging, dropProps } = useFileDrop((dropped) => {
    setFiles(dropped);
    setDone(null);
  });

  async function upload() {
    if (files.length === 0) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await uploadDocuments(files);
      setDone(result.documents.length);
      setErrors(result.errors);
      if (result.documents.length) {
        notify(
          `${result.documents.length} file${result.documents.length === 1 ? "" : "s"} stored.`,
        );
      }
      setFiles([]);
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "The upload could not complete.",
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="page-intro">
        Receipts, invoices, statements, images, PDFs and spreadsheets are stored
        as their original files, up to 20 MB each. A document whose details
        cannot be read with certainty is marked <strong>review</strong> rather
        than turned into an invented transaction.
      </p>

      {done !== null ? (
        <Notice kind="success">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            {done} file{done === 1 ? "" : "s"} stored in your document vault.
          </span>
        </Notice>
      ) : null}

      {errors.map((message, index) => (
        <Notice kind="error" key={index}>
          {message}
        </Notice>
      ))}

      <div
        className={`drop-zone ${isDragging ? "drop-zone--active" : ""}`}
        style={{ padding: 4 }}
        {...dropProps}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          accept="image/*,application/pdf,.csv,.xlsx,.xls,.txt,.tsv"
          onChange={(event) => {
            setFiles([...(event.target.files ?? [])]);
            setDone(null);
          }}
        />

        <button
          type="button"
          className="btn btn--block"
          onClick={() => fileRef.current?.click()}
        >
          <FileUp size={17} aria-hidden="true" />
          Choose files, or drag them here
        </button>
      </div>

      {files.length > 0 ? (
        <div className="card card--pad">
          {files.map((file) => (
            <div className="stat-line" key={file.name}>
              <span className="stat-line__label">{file.name}</span>
              <span className="stat-line__value">{formatBytes(file.size)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row row--between">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Close
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void upload()}
          disabled={busy || files.length === 0}
        >
          {busy ? (
            <Spinner label="Uploading" />
          ) : (
            <>
              <Upload size={16} aria-hidden="true" />
              Upload {files.length || ""}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
