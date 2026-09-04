import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/* =================================================================== card */

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`card card--pad ${className}`}>{children}</Tag>;
}

export function CardHead({
  title,
  hint,
  action,
  id,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <header className="card__head">
      <div>
        <h2 className="card__title" id={id}>
          {title}
        </h2>
        {hint ? <p className="card__hint">{hint}</p> : null}
      </div>
      {action}
    </header>
  );
}

/* ============================================================ empty state */

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
      {action}
    </div>
  );
}

/* ================================================================== modal */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: traps focus, closes on Escape and on the visible close
 * button, restores focus to the trigger, and scrolls internally on small screens.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  compact?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();

  /**
   * Callers pass an inline `onClose`, so its identity changes on every render.
   * Reading it through a ref keeps the setup effect mount-only: otherwise any
   * unrelated re-render (a toast expiring, say) would re-run the effect, move
   * focus back to the close button and shut an open dropdown mid-interaction.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;

    const focusables = node?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables?.[0];
    (first ?? node)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;

      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
    // Mount-only on purpose — see the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal--wide" : ""} ${
          compact ? "modal--compact" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle ? (
              <p className="modal__subtitle" id={subtitleId}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ================================================================= fields */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="field__hint">{hint}</p> : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* =============================================================== progress */

export function ProgressBar({
  value,
  max,
  tone = "violet",
  label,
}: {
  value: number;
  max: number;
  tone?: "violet" | "green" | "orange" | "red";
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const toneClass = tone === "violet" ? "" : `progress__fill--${tone}`;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-label={label}
    >
      <div className={`progress__fill ${toneClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ================================================================ notices */

export function Notice({
  kind,
  children,
}: {
  kind: "error" | "success" | "info" | "warn";
  children: ReactNode;
}) {
  return (
    <p className={`notice notice--${kind}`} role={kind === "error" ? "alert" : undefined}>
      {children}
    </p>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      role="status"
    >
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

/* ============================================================== confirming */

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
  busy = false,
  danger = true,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner label="Working" /> : confirmLabel}
          </button>
        </>
      }
    >
      {typeof body === "string" ? <p>{body}</p> : body}
    </Modal>
  );
}

/* ========================================================== confirm-close */

/**
 * Guards a modal's close against accidentally discarding typed input —
 * Escape and a backdrop click are one keystroke/click away in every modal,
 * and neither should silently throw away a half-filled form.
 *
 * Usage: pass `requestClose` as both the Modal's `onClose` and the form's
 * own Cancel button, and render `discardPrompt` alongside the modal.
 */
export function useConfirmClose(isDirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    if (isDirty) setConfirming(true);
    else onClose();
  }, [isDirty, onClose]);

  const discardPrompt = confirming ? (
    <ConfirmDialog
      title="Discard changes?"
      body="What you've entered here hasn't been saved. Leaving now will lose it."
      confirmLabel="Discard"
      onCancel={() => setConfirming(false)}
      onConfirm={() => {
        setConfirming(false);
        onClose();
      }}
    />
  ) : null;

  return { requestClose, discardPrompt };
}

/* ============================================================ file drop */

/**
 * Adds drag-and-drop to any container that already has a working
 * click-to-browse file input — spread `dropProps` onto that container and
 * read `isDragging` to show a highlight while a file is over it.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const dropProps = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      depth.current += 1;
      if (event.dataTransfer.types.includes("Files")) setIsDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
    },
    onDragLeave: (event: React.DragEvent) => {
      event.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      const files = [...event.dataTransfer.files];
      if (files.length > 0) onFiles(files);
    },
  };

  return { isDragging, dropProps };
}
