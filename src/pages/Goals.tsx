import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { Goal } from "../../shared/types";
import {
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Notice,
  ProgressBar,
  Spinner,
  useConfirmClose,
} from "../components/ui";
import { formatDate, money, percent } from "../lib/format";
import { useAppState, usePocketLedger } from "../store";

export function Goals() {
  const state = useAppState();
  const { savePreferences, notify } = usePocketLedger();
  const goals = state.settings.goals;

  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function saveGoal(goal: Goal) {
    const exists = goals.some((g) => g.id === goal.id);
    await savePreferences({
      goals: exists ? goals.map((g) => (g.id === goal.id ? goal : g)) : [...goals, goal],
    });
    notify(exists ? "Goal updated." : "Goal created.");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await savePreferences({ goals: goals.filter((g) => g.id !== deleteTarget.id) });
      notify("Goal deleted.");
      setDeleteTarget(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That goal was not deleted.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h2 className="section-title">Goals</h2>
          <p className="page-intro">
            Track what you are saving toward. Amounts here are yours to set —
            Pocket Ledger never moves money or invents progress.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setEditing("new")}
        >
          <Plus size={16} aria-hidden="true" />
          Add goal
        </button>
      </div>

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target size={20} />}
            title="No goals yet"
            text="Create a goal with a name and a target amount to start tracking progress."
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setEditing("new")}
              >
                Create goal
              </button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid--2">
          {goals.map((goal) => {
            const pct = goal.target > 0 ? (goal.current / goal.target) * 100 : 0;
            const remaining = Math.max(0, goal.target - goal.current);
            const complete = goal.current >= goal.target && goal.target > 0;
            return (
              <Card key={goal.id}>
                <div className="row row--between" style={{ marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p className="card__title">{goal.name}</p>
                    <p className="card__hint">
                      {goal.dueDate ? `Due ${formatDate(goal.dueDate)}` : "No due date"}
                    </p>
                  </div>
                  <span className={`pill ${complete ? "pill--green" : "pill--violet"}`}>
                    {percent(Math.min(100, pct))}
                  </span>
                </div>

                <ProgressBar
                  value={goal.current}
                  max={goal.target || 1}
                  tone={complete ? "green" : "violet"}
                  label={`${goal.name} progress`}
                />

                <div className="stat-line" style={{ marginTop: 10 }}>
                  <span className="stat-line__label">Saved</span>
                  <span className="stat-line__value">{money(goal.current)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">Target</span>
                  <span className="stat-line__value">{money(goal.target)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">Remaining</span>
                  <span className="stat-line__value">{money(remaining)}</span>
                </div>

                {goal.note ? <p className="card__hint">{goal.note}</p> : null}

                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setEditing(goal)}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setDeleteTarget(goal)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing ? (
        <GoalModal
          goal={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveGoal}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete this goal?"
          body={`“${deleteTarget.name}” will be removed. This cannot be undone.`}
          confirmLabel="Delete goal"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}

function GoalModal({
  goal,
  onClose,
  onSave,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSave: (goal: Goal) => Promise<void>;
}) {
  const ids = {
    name: useId(),
    target: useId(),
    current: useId(),
    due: useId(),
    note: useId(),
  };

  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [current, setCurrent] = useState(goal ? String(goal.current) : "");
  const [dueDate, setDueDate] = useState(goal?.dueDate ?? "");
  const [note, setNote] = useState(goal?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty =
    name !== (goal?.name ?? "") ||
    target !== (goal ? String(goal.target) : "") ||
    current !== (goal ? String(goal.current) : "") ||
    dueDate !== (goal?.dueDate ?? "") ||
    note !== (goal?.note ?? "");
  const { requestClose, discardPrompt } = useConfirmClose(isDirty, onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Enter a goal name.";
    const targetValue = Number(target);
    if (!target.trim() || !Number.isFinite(targetValue) || targetValue <= 0)
      next.target = "Enter a target greater than 0.";
    const currentValue = current.trim() ? Number(current) : 0;
    if (!Number.isFinite(currentValue) || currentValue < 0)
      next.current = "Enter 0 or more.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setFormError(null);
    try {
      await onSave({
        id: goal?.id ?? crypto.randomUUID(),
        name: name.trim(),
        target: targetValue,
        current: currentValue,
        dueDate: dueDate || undefined,
        note: note.trim() || undefined,
        createdAt: goal?.createdAt ?? new Date().toISOString(),
      });
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "That goal was not saved.",
      );
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      title={goal ? "Edit goal" : "Create goal"}
      onClose={requestClose}
      footer={
        <>
          <button type="button" className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="goal-form"
            className="btn btn--primary"
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save goal"}
          </button>
        </>
      }
    >
      <form id="goal-form" className="stack" onSubmit={submit} noValidate>
        {formError ? <Notice kind="error">{formError}</Notice> : null}

        <Field label="Goal name" error={errors.name} htmlFor={ids.name}>
          <input
            id={ids.name}
            className="input"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div className="grid grid--2">
          <Field label="Target amount" error={errors.target} htmlFor={ids.target}>
            <input
              id={ids.target}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </Field>

          <Field
            label="Saved so far"
            error={errors.current}
            htmlFor={ids.current}
          >
            <input
              id={ids.current}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Due date (optional)" htmlFor={ids.due}>
          <input
            id={ids.due}
            className="input"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>

        <Field label="Note (optional)" htmlFor={ids.note}>
          <textarea
            id={ids.note}
            className="textarea"
            maxLength={400}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
    {discardPrompt}
    </>
  );
}
