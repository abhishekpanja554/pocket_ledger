import { Pencil, Plus, Tag as TagIcon, Trash2, Wand2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Rule } from "../../shared/types";
import {
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Notice,
  Spinner,
  useConfirmClose,
} from "../components/ui";
import { useAppState, usePocketLedger } from "../store";

export function Rules() {
  const state = useAppState();
  const { savePreferences, notify } = usePocketLedger();

  const [editingRule, setEditingRule] = useState<Rule | "new" | null>(null);
  const [deleteRule, setDeleteRule] = useState<Rule | null>(null);
  const [deleteTag, setDeleteTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const newTagId = useId();

  const tagUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of state.transactions) {
      for (const tag of tx.tags) {
        const key = tag.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [state.transactions]);

  async function saveRule(rule: Rule) {
    const exists = state.rules.some((r) => r.id === rule.id);
    const next = exists
      ? state.rules.map((r) => (r.id === rule.id ? rule : r))
      : [...state.rules, rule];
    await savePreferences({ rules: next });
    notify(exists ? "Rule updated." : "Rule created.");
  }

  async function toggleRule(rule: Rule) {
    try {
      await savePreferences({
        rules: state.rules.map((r) =>
          r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
        ),
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That change was not saved.",
        "error",
      );
    }
  }

  async function confirmDeleteRule() {
    if (!deleteRule) return;
    setBusy(true);
    try {
      await savePreferences({
        rules: state.rules.filter((r) => r.id !== deleteRule.id),
      });
      notify("Rule deleted.");
      setDeleteRule(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That rule was not deleted.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addTag() {
    const name = tagDraft.trim();
    if (!name) {
      setTagError("Enter a tag name.");
      return;
    }
    if (state.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setTagError("That tag already exists.");
      return;
    }
    setAddingTag(true);
    setTagError(null);
    try {
      await savePreferences({
        tags: [...state.tags.map((t) => t.name), name],
      });
      setTagDraft("");
      notify("Tag created.");
    } catch (error) {
      setTagError(
        error instanceof Error ? error.message : "That tag was not created.",
      );
    } finally {
      setAddingTag(false);
    }
  }

  async function removeTag(name: string, strip: boolean) {
    setBusy(true);
    try {
      await savePreferences({
        tags: state.tags.map((t) => t.name).filter((t) => t !== name),
        ...(strip ? { stripTagsFromTransactions: [name] } : {}),
      });
      notify(
        strip
          ? "Tag deleted and removed from past transactions."
          : "Tag deleted. Past transactions keep it.",
      );
      setDeleteTag(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That tag was not deleted.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  const usedCount = deleteTag ? (tagUsage.get(deleteTag.toLowerCase()) ?? 0) : 0;

  return (
    <div className="stack">
      <Card>
        <CardHead
          title="Categorization rules"
          hint="Applied to future imports, after duplicate detection. Existing transactions are left alone."
          action={
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setEditingRule("new")}
            >
              <Plus size={15} aria-hidden="true" />
              Create rule
            </button>
          }
        />

        {state.rules.length === 0 ? (
          <EmptyState
            icon={<Wand2 size={20} />}
            title="No rules yet"
            text="A rule reads as “When … then …”, for example: when a merchant contains a name, then set a category or add a tag."
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setEditingRule("new")}
              >
                Create your first rule
              </button>
            }
          />
        ) : (
          <div>
            {state.rules.map((rule) => (
              <div className="list-row" key={rule.id}>
                <div className="list-row__main">
                  <p className="list-row__title">
                    When <em>{rule.whenText}</em>
                  </p>
                  <p className="list-row__meta">then {rule.thenText}</p>
                </div>
                <label className="checkbox" style={{ minHeight: 0 }}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => void toggleRule(rule)}
                  />
                  <span className="cell-meta">
                    {rule.enabled ? "Enabled" : "Off"}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setEditingRule(rule)}
                  aria-label={`Edit rule ${rule.whenText}`}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setDeleteRule(rule)}
                  aria-label={`Delete rule ${rule.whenText}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead
          title="Tags"
          hint="A tag needs a name and nothing else — no category, colour or rule."
        />

        <div className="row" style={{ gap: 8, flexWrap: "nowrap", marginBottom: 12 }}>
          <input
            id={newTagId}
            className="input"
            placeholder="New tag name"
            aria-label="New tag name"
            maxLength={40}
            value={tagDraft}
            onChange={(event) => {
              setTagDraft(event.target.value);
              setTagError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addTag();
              }
            }}
          />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void addTag()}
            disabled={addingTag}
          >
            {addingTag ? <Spinner label="Adding" /> : (
              <>
                <Plus size={16} aria-hidden="true" />
                Create tag
              </>
            )}
          </button>
        </div>
        {tagError ? <Notice kind="error">{tagError}</Notice> : null}

        {state.tags.length === 0 ? (
          <EmptyState
            icon={<TagIcon size={20} />}
            title="No tags yet"
            text="Create a tag above, or add one directly to a transaction."
          />
        ) : (
          <div>
            {state.tags.map((tag) => (
              <div className="list-row" key={tag.name}>
                <div className="list-row__main">
                  <p className="list-row__title">{tag.name}</p>
                  <p className="list-row__meta">
                    Used on {tagUsage.get(tag.name.toLowerCase()) ?? 0} transaction
                    {(tagUsage.get(tag.name.toLowerCase()) ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setDeleteTag(tag.name)}
                  aria-label={`Delete tag ${tag.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editingRule ? (
        <RuleModal
          rule={editingRule === "new" ? null : editingRule}
          categories={state.settings.categories}
          onClose={() => setEditingRule(null)}
          onSave={saveRule}
        />
      ) : null}

      {deleteRule ? (
        <ConfirmDialog
          title="Delete this rule?"
          body={`“When ${deleteRule.whenText} then ${deleteRule.thenText}” will stop applying to future imports.`}
          confirmLabel="Delete rule"
          busy={busy}
          onCancel={() => setDeleteRule(null)}
          onConfirm={() => void confirmDeleteRule()}
        />
      ) : null}

      {deleteTag ? (
        <Modal
          title={`Delete the tag “${deleteTag}”?`}
          onClose={() => setDeleteTag(null)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteTag(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void removeTag(deleteTag, false)}
                disabled={busy}
              >
                Delete, keep on past transactions
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void removeTag(deleteTag, true)}
                disabled={busy}
              >
                Delete and strip everywhere
              </button>
            </>
          }
        >
          <p>
            This tag is on <strong>{usedCount}</strong> transaction
            {usedCount === 1 ? "" : "s"}. Removing the definition takes it out of
            future selectors. Choose whether past transactions should keep it.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function RuleModal({
  rule,
  categories,
  onClose,
  onSave,
}: {
  rule: Rule | null;
  categories: string[];
  onClose: () => void;
  onSave: (rule: Rule) => Promise<void>;
}) {
  const ids = { when: useId(), then: useId() };
  const [whenText, setWhenText] = useState(rule?.whenText ?? "");
  const [thenText, setThenText] = useState(rule?.thenText ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty =
    whenText !== (rule?.whenText ?? "") ||
    thenText !== (rule?.thenText ?? "") ||
    enabled !== (rule?.enabled ?? true);
  const { requestClose, discardPrompt } = useConfirmClose(isDirty, onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!whenText.trim()) next.when = "Describe what to match.";
    if (!thenText.trim()) next.then = "Describe what should happen.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setFormError(null);
    try {
      await onSave({
        id: rule?.id ?? crypto.randomUUID(),
        whenText: whenText.trim(),
        thenText: thenText.trim(),
        enabled,
        createdAt: rule?.createdAt ?? new Date().toISOString(),
      });
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "That rule was not saved.",
      );
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      title={rule ? "Edit rule" : "Create rule"}
      subtitle="Rules run on new imports only, after duplicates are filtered out."
      onClose={requestClose}
      footer={
        <>
          <button type="button" className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="rule-form"
            className="btn btn--primary"
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save rule"}
          </button>
        </>
      }
    >
      <form id="rule-form" className="stack" onSubmit={submit} noValidate>
        {formError ? <Notice kind="error">{formError}</Notice> : null}

        <Field
          label="When the merchant or source…"
          hint="For example: contains coffee house"
          error={errors.when}
          htmlFor={ids.when}
        >
          <input
            id={ids.when}
            className="input"
            placeholder="contains …"
            value={whenText}
            maxLength={200}
            onChange={(event) => setWhenText(event.target.value)}
          />
        </Field>

        <Field
          label="Then…"
          hint={`For example: category: ${categories[0] ?? "Dining"}, tag: work`}
          error={errors.then}
          htmlFor={ids.then}
        >
          <input
            id={ids.then}
            className="input"
            placeholder="category: … , tag: …"
            value={thenText}
            maxLength={200}
            onChange={(event) => setThenText(event.target.value)}
          />
        </Field>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enabled
        </label>
      </form>
    </Modal>
    {discardPrompt}
    </>
  );
}
