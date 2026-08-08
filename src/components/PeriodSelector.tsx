import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PeriodId } from "../../shared/types";
import { PERIOD_OPTIONS, periodLabel } from "../lib/period";
import { usePocketLedger } from "../store";

/**
 * The one date-period control. Both Dashboard and Transactions render it and
 * both read the same persisted value, so changing it in one place updates the
 * other.
 */
export function PeriodSelector({ align = "left" }: { align?: "left" | "right" }) {
  const { state, setPeriod } = usePocketLedger();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<PeriodId | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = state?.settings.selectedPeriod ?? "all-time";

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(period: PeriodId) {
    setOpen(false);
    if (period === selected) return;
    setSaving(period);
    await setPeriod(period);
    setSaving(null);
  }

  return (
    <div className="dropdown" ref={wrapRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={!state}
      >
        <CalendarRange size={16} aria-hidden="true" />
        <span>{periodLabel(selected)}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open ? (
        <div
          className={`dropdown__menu ${align === "right" ? "dropdown__menu--right" : ""}`}
          role="listbox"
          aria-label="Date period"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === selected}
              className="dropdown__item"
              onClick={() => void choose(option.id)}
            >
              <span style={{ flex: 1 }}>{option.label}</span>
              {option.id === selected ? (
                <Check size={15} aria-hidden="true" />
              ) : null}
              {saving === option.id ? <span className="spinner" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
