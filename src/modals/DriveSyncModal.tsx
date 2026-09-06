import { Copy, ExternalLink, FolderSync, Info, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Field, Modal, Notice, Spinner } from "../components/ui";
import { ApiError } from "../lib/api";
import { formatTimestamp } from "../lib/format";
import { usePocketLedger } from "../store";

const FOLDER_NAME = "Pocket Ledger Financial Inbox";

// The automation reads Drive as this one fixed service account, not as the
// signed-in user — Drive only lets it see folders explicitly shared with it.
// Skipping that share step is invisible: Drive's list API returns an empty
// result for a folder the account can't see, with no error, so sync silently
// finds "0 new files" forever until this step is done.
const SERVICE_ACCOUNT_EMAIL =
  "pocket-ledger-drive@pocket-ledger-506818.iam.gserviceaccount.com";

/**
 * The Site never browses Google Drive from the browser. This dialog records the
 * dedicated folder and schedule metadata, and shows what the daily automation
 * last reported to /api/drive-sync.
 */
export function DriveSyncModal({ onClose }: { onClose: () => void }) {
  const { state, savePreferences, runDriveSync, notify } = usePocketLedger();
  const ids = { name: useId(), folderId: useId(), url: useId(), tz: useId() };

  const settings = state?.settings;
  const folder = settings?.driveFolder ?? null;
  const sync = settings?.driveSync;
  const schedule = settings?.driveSchedule;

  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    try {
      await runDriveSync();
      notify("Drive sync finished.");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Drive sync could not run right now.",
        "error",
      );
    } finally {
      setSyncing(false);
    }
  }

  const [name, setName] = useState(folder?.name ?? FOLDER_NAME);
  const [folderId, setFolderId] = useState(folder?.id ?? "");
  const [url, setUrl] = useState(folder?.url ?? "");
  const [timezone, setTimezone] = useState(
    schedule?.timezone && schedule.timezone !== "UTC"
      ? schedule.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyServiceAccountEmail() {
    try {
      await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
      notify("Copied. Paste it into the folder's Share dialog in Drive.");
    } catch {
      notify("Could not copy automatically — select and copy the address above.", "error");
    }
  }

  async function save() {
    setError(null);
    if (!folderId.trim()) {
      setError("Enter the Drive folder ID so the automation targets one exact folder.");
      return;
    }
    setSaving(true);
    try {
      await savePreferences({
        driveFolder: {
          id: folderId.trim(),
          name: name.trim() || FOLDER_NAME,
          url:
            url.trim() ||
            `https://drive.google.com/drive/folders/${encodeURIComponent(
              folderId.trim(),
            )}`,
        },
        driveSchedule: { time: "08:00", timezone: timezone.trim() || "UTC", cadence: "daily" },
      });
      notify("Drive inbox settings saved.");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Those settings could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Drive sync"
      subtitle="Your dedicated Google Drive inbox and its daily schedule."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save folder settings"}
          </button>
        </>
      }
    >
      {error ? <Notice kind="error">{error}</Notice> : null}

      <Notice kind="info">
        <Info size={18} aria-hidden="true" />
        <span>
          Pocket Ledger never reads Drive from your browser. A scheduled automation
          reads only this one folder using its own dedicated Drive account — not
          your Google login — so the folder has to be shared with that account
          before anything below will find files in it.
        </span>
      </Notice>

      <div className="card card--pad stack" style={{ gap: 8 }}>
        <p className="field__label">Step 1 — share the folder</p>
        <p className="field__hint">
          In Google Drive, right-click the folder → Share, then add this address
          with Viewer access:
        </p>
        <div className="stat-line">
          <code style={{ wordBreak: "break-all" }}>{SERVICE_ACCOUNT_EMAIL}</code>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => void copyServiceAccountEmail()}
            title="Copy address"
          >
            <Copy size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="field__hint">
          Skipping this step isn't obvious when it goes wrong: Drive just reports
          an empty folder to the automation, so sync keeps finding “0 new files”
          with no error at all.
        </p>
      </div>

      <div className="card card--pad">
        <div className="stat-line">
          <span className="stat-line__label">Schedule</span>
          <span className="stat-line__value">
            Daily at {schedule?.time ?? "08:00"} ({schedule?.timezone ?? "UTC"})
          </span>
        </div>
        <div className="stat-line">
          <span className="stat-line__label">Last sync</span>
          <span className="stat-line__value">
            {formatTimestamp(sync?.lastSyncedAt ?? null)}
          </span>
        </div>
        <div className="stat-line">
          <span className="stat-line__label">Last result</span>
          <span className="stat-line__value">
            {sync?.status === "never"
              ? "No sync has run yet"
              : `${sync?.imported ?? 0} imported · ${sync?.duplicates ?? 0} duplicates · ${
                  sync?.filesStored ?? 0
                } files · ${sync?.review ?? 0} to review`}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="btn"
        onClick={() => void syncNow()}
        disabled={syncing || !folder}
        title={folder ? undefined : "Set a Drive folder below first"}
      >
        {syncing ? (
          <Spinner label="Syncing" />
        ) : (
          <>
            <RefreshCw size={16} aria-hidden="true" />
            Sync now
          </>
        )}
      </button>

      {sync?.errors?.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <p className="field__label">Reported problems</p>
          {sync.errors.map((message, index) => (
            <p className="field__hint" key={index}>
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <p className="field__label">Step 2 — tell Pocket Ledger which folder</p>

      <Field
        label="Folder name"
        hint="Use one dedicated folder. The expected name is “Pocket Ledger Financial Inbox”."
        htmlFor={ids.name}
      >
        <input
          id={ids.name}
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        label="Folder ID"
        hint="From the folder URL: drive.google.com/drive/folders/<this part>"
        htmlFor={ids.folderId}
      >
        <input
          id={ids.folderId}
          className="input"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field label="Folder link (optional)" htmlFor={ids.url}>
        <input
          id={ids.url}
          className="input"
          type="url"
          placeholder="https://drive.google.com/drive/folders/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field>

      <Field
        label="Timezone for the 8:00 AM run"
        hint="An IANA name such as America/New_York."
        htmlFor={ids.tz}
      >
        <input
          id={ids.tz}
          className="input"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </Field>

      {folder?.url ? (
        <a
          className="btn"
          href={folder.url}
          target="_blank"
          rel="noreferrer noopener"
          style={{ alignSelf: "flex-start" }}
        >
          <FolderSync size={16} aria-hidden="true" />
          Open the Drive folder
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </Modal>
  );
}
