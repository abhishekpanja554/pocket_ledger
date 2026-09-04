import {
  Download,
  ExternalLink,
  FileText,
  FolderSync,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import type { DocumentRow } from "../../shared/types";
import { useUi } from "../App";
import { Card, CardHead, ConfirmDialog, EmptyState, Notice } from "../components/ui";
import { api } from "../lib/api";
import { fileKind, formatBytes, formatTimestamp } from "../lib/format";
import { useAppState, usePocketLedger } from "../store";

export function Documents() {
  const state = useAppState();
  const { uploadDocuments, deleteDocument, notify } = usePocketLedger();
  const { openModal } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { driveFolder, driveSchedule, driveSync } = state.settings;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await uploadDocuments([...files]);
      setErrors(result.errors);
      if (result.documents.length) {
        notify(
          `${result.documents.length} file${result.documents.length === 1 ? "" : "s"} stored.`,
        );
      }
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "The upload could not complete.",
      ]);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDocument(deleteTarget.id);
      notify("Document deleted from the vault.");
      setDeleteTarget(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That document was not deleted.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid grid--2">
        <Card>
          <CardHead
            title="Upload documents"
            hint="Receipts, statements, invoices, PDFs, images, CSVs and spreadsheets. 20 MB maximum per file."
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            accept="image/*,application/pdf,.csv,.xlsx,.xls,.txt,.tsv"
            onChange={(event) => void onFiles(event.target.files)}
          />
          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={16} aria-hidden="true" />
              {busy ? "Uploading…" : "Choose files"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => openModal("import")}
            >
              Open the full import flow
            </button>
          </div>

          {errors.map((message, index) => (
            <Notice kind="error" key={index}>
              {message}
            </Notice>
          ))}

          <p className="card__hint" style={{ marginTop: 10 }}>
            Original files are stored on your Pocket Ledger server. Pocket Ledger does
            not add any encryption beyond the storage platform's own protections.
          </p>
        </Card>

        <Card>
          <CardHead
            title="Google Drive inbox"
            hint="A scheduled automation checks this folder for you."
            action={
              <span className="pill pill--green">
                <ShieldCheck size={12} aria-hidden="true" />
                {driveSchedule.cadence === "daily"
                  ? `Daily ${driveSchedule.time}`
                  : "Scheduled"}
              </span>
            }
          />

          <div className="stat-line">
            <span className="stat-line__label">Folder</span>
            <span className="stat-line__value">
              {driveFolder?.name ?? "Not configured yet"}
            </span>
          </div>
          <div className="stat-line">
            <span className="stat-line__label">Timezone</span>
            <span className="stat-line__value">{driveSchedule.timezone}</span>
          </div>
          <div className="stat-line">
            <span className="stat-line__label">Last sync</span>
            <span className="stat-line__value">
              {formatTimestamp(driveSync.lastSyncedAt)}
            </span>
          </div>
          <div className="stat-line">
            <span className="stat-line__label">Last result</span>
            <span className="stat-line__value">
              {driveSync.status === "never"
                ? "No sync yet"
                : `${driveSync.imported} imported · ${driveSync.duplicates} duplicates · ${driveSync.filesStored} files · ${driveSync.review} to review`}
            </span>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={() => openModal("drive")}
            >
              <FolderSync size={16} aria-hidden="true" />
              Drive sync settings
            </button>
            {driveFolder?.url ? (
              <a
                className="btn"
                href={driveFolder.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                View folder
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Document vault"
          hint={`${state.documents.length} file${
            state.documents.length === 1 ? "" : "s"
          } stored.`}
        />
        {state.documents.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title="No documents yet"
            text="Upload a file or add one to your Drive inbox."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Stored documents</caption>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Type</th>
                  <th scope="col">Size</th>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Imported</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div className="cell-merchant">{doc.filename}</div>
                    </td>
                    <td className="cell-meta">
                      {fileKind(doc.mimeType, doc.filename)}
                    </td>
                    <td className="cell-meta">{formatBytes(doc.size)}</td>
                    <td className="cell-meta">
                      {doc.source === "google-drive" ? "Google Drive" : "Upload"}
                    </td>
                    <td>
                      <span
                        className={`pill ${
                          doc.status === "stored"
                            ? "pill--green"
                            : doc.status === "review"
                              ? "pill--orange"
                              : "pill--blue"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="cell-meta">{formatTimestamp(doc.createdAt)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <a
                        className="btn btn--ghost btn--sm"
                        href={api.documentUrl(doc.id)}
                        download={doc.filename}
                        aria-label={`Download ${doc.filename}`}
                      >
                        <Download size={15} aria-hidden="true" />
                      </a>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setDeleteTarget(doc)}
                        aria-label={`Delete ${doc.filename}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {state.documents.length > 0 ? (
          <div className="tx-list" style={{ marginTop: 12 }}>
            {state.documents.map((doc) => (
              <article className="tx-card" key={doc.id}>
                <div className="tx-card__top">
                  <div style={{ minWidth: 0 }}>
                    <p className="list-row__title">{doc.filename}</p>
                    <p className="list-row__meta">
                      {fileKind(doc.mimeType, doc.filename)} ·{" "}
                      {formatBytes(doc.size)} ·{" "}
                      {doc.source === "google-drive" ? "Google Drive" : "Upload"}
                    </p>
                  </div>
                  <span
                    className={`pill ${
                      doc.status === "stored"
                        ? "pill--green"
                        : doc.status === "review"
                          ? "pill--orange"
                          : "pill--blue"
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
                <div className="row row--between">
                  <span className="cell-meta">
                    {formatTimestamp(doc.createdAt)}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <a
                      className="btn btn--sm"
                      href={api.documentUrl(doc.id)}
                      download={doc.filename}
                    >
                      <Download size={14} aria-hidden="true" />
                      Download
                    </a>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setDeleteTarget(doc)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </Card>

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete this document?"
          body={`“${deleteTarget.filename}” and its stored copy will be removed from Pocket Ledger. The original in Google Drive, if any, is untouched.`}
          confirmLabel="Delete document"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}
