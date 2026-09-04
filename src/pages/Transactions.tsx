import { Check, Pencil, Plus, Receipt, Search, Tag as TagIcon, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Tag, Transaction } from "../../shared/types";
import { useUi } from "../App";
import { PeriodSelector } from "../components/PeriodSelector";
import { TagPicker } from "../components/TagPicker";
import { AddEntryModal } from "../modals/AddEntryModal";
import {
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  Notice,
  Spinner,
  useConfirmClose,
} from "../components/ui";
import { formatDate, money, signedMoney } from "../lib/format";
import { filterByPeriod, periodLabel } from "../lib/period";
import { useAppState, usePocketLedger } from "../store";

type BulkAction = "category" | "tag" | "delete" | null;

export function Transactions() {
  const state = useAppState();
  const { notify, deleteTransaction, updateTransaction } = usePocketLedger();
  const { openModal } = useUi();

  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("all");
  const [category, setCategory] = useState("all");
  const [tagModalFor, setTagModalFor] = useState<Transaction | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const period = state.settings.selectedPeriod;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return filterByPeriod(state.transactions, period)
      .filter((tx) => (account === "all" ? true : tx.account === account))
      .filter((tx) => (category === "all" ? true : tx.category === category))
      .filter((tx) => {
        if (!needle) return true;
        return (
          tx.merchant.toLowerCase().includes(needle) ||
          tx.category.toLowerCase().includes(needle) ||
          tx.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) =>
        a.date === b.date
          ? b.createdAt.localeCompare(a.createdAt)
          : b.date.localeCompare(a.date),
      );
  }, [state.transactions, period, search, account, category]);

  const totals = useMemo(
    () => ({
      income: rows
        .filter((tx) => tx.type === "income")
        .reduce((sum, tx) => sum + tx.amount, 0),
      spending: rows
        .filter((tx) => tx.type === "expense")
        .reduce((sum, tx) => sum + tx.amount, 0),
    }),
    [rows],
  );

  const accountOptions = useMemo(() => {
    const names = new Set<string>(state.settings.accounts);
    for (const tx of state.transactions) names.add(tx.account);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [state.settings.accounts, state.transactions]);

  const categoryOptions = useMemo(() => {
    const names = new Set<string>(state.settings.categories);
    for (const tx of state.transactions) names.add(tx.category);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [state.settings.categories, state.transactions]);

  // A selection only ever acts on rows that are still visible under the
  // current filters — if a filter hides a selected row, it's just left out
  // of the count and any bulk action, not force-deselected.
  const selectedRows = useMemo(
    () => rows.filter((tx) => selected.has(tx.id)),
    [rows, selected],
  );
  const allVisibleSelected = rows.length > 0 && selectedRows.length === rows.length;

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        for (const tx of rows) next.delete(tx.id);
        return next;
      }
      const next = new Set(current);
      for (const tx of rows) next.add(tx.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkSetCategory(nextCategory: string) {
    setBulkBusy(true);
    try {
      await Promise.all(
        selectedRows.map((tx) => updateTransaction(tx.id, { category: nextCategory })),
      );
      notify(
        `${selectedRows.length} transaction${selectedRows.length === 1 ? "" : "s"} set to ${nextCategory}.`,
      );
      clearSelection();
      setBulkAction(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The category change did not fully save.",
        "error",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAddTags(tagsToAdd: string[]) {
    setBulkBusy(true);
    try {
      await Promise.all(
        selectedRows.map((tx) => {
          const merged = new Set(tx.tags.map((t) => t.toLowerCase()));
          const nextTags = [...tx.tags];
          for (const tag of tagsToAdd) {
            if (!merged.has(tag.toLowerCase())) {
              merged.add(tag.toLowerCase());
              nextTags.push(tag);
            }
          }
          return updateTransaction(tx.id, { tags: nextTags });
        }),
      );
      notify(`Tags added to ${selectedRows.length} transaction${selectedRows.length === 1 ? "" : "s"}.`);
      clearSelection();
      setBulkAction(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The tags did not fully save.",
        "error",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    setBulkBusy(true);
    try {
      await Promise.all(selectedRows.map((tx) => deleteTransaction(tx.id)));
      notify(`${selectedRows.length} transaction${selectedRows.length === 1 ? "" : "s"} deleted.`);
      clearSelection();
      setBulkAction(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The deletion did not fully complete.",
        "error",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTransaction(deleteTarget.id);
      notify("Transaction deleted.");
      setDeleteTarget(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "It could not be deleted.",
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
          <h2 className="section-title">Transactions</h2>
          <p className="page-intro">
            {periodLabel(period)} · {rows.length} shown ·{" "}
            {money(totals.income)} in · {money(totals.spending)} out
          </p>
        </div>
        <div className="row">
          <PeriodSelector align="right" />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openModal("add-entry")}
          >
            <Plus size={16} aria-hidden="true" />
            Add entry
          </button>
        </div>
      </div>

      <Card>
        <div className="filters">
          <div className="search-field">
            <Search size={16} className="search-field__icon" aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Search merchant, category or tag"
              aria-label="Search transactions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <select
            className="select"
            aria-label="Filter by account"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          >
            <option value="all">All accounts</option>
            {accountOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="select"
            aria-label="Filter by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">All categories</option>
            {categoryOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn"
            onClick={() => {
              setSearch("");
              setAccount("all");
              setCategory("all");
            }}
            disabled={search === "" && account === "all" && category === "all"}
          >
            Clear filters
          </button>
        </div>
      </Card>

      {selectedRows.length > 0 ? (
        <Card className="bulk-bar">
          <div className="row row--between">
            <span className="cell-meta">
              <strong>{selectedRows.length}</strong> selected
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setBulkAction("category")}
              >
                Set category
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setBulkAction("tag")}
              >
                <TagIcon size={14} aria-hidden="true" />
                Add tag
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setBulkAction("delete")}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </button>
              <button type="button" className="btn btn--sm" onClick={clearSelection}>
                Clear
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt size={20} />}
            title={
              state.transactions.length === 0
                ? "No transactions yet"
                : "Nothing matches these filters"
            }
            text={
              state.transactions.length === 0
                ? "Add an entry, import a CSV statement, or drop a document into your Drive inbox."
                : "Try a different period, account, category or search term."
            }
            action={
              state.transactions.length === 0 ? (
                <div className="row" style={{ justifyContent: "center" }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => openModal("add-entry")}
                  >
                    Add entry
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => openModal("import")}
                  >
                    Import CSV
                  </button>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                Transactions for {periodLabel(period)}
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Select all transactions in this view"
                    />
                  </th>
                  <th scope="col">Date &amp; merchant</th>
                  <th scope="col">Category</th>
                  <th scope="col">Account</th>
                  <th scope="col">Tags</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Amount
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => (
                  <tr key={tx.id} className={selected.has(tx.id) ? "tr--selected" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(tx.id)}
                        onChange={() => toggleOne(tx.id)}
                        aria-label={`Select ${tx.merchant} on ${formatDate(tx.date)}`}
                      />
                    </td>
                    <td>
                      <div className="cell-merchant">
                        {tx.merchant}
                        {tx.receipt ? (
                          <span
                            className="pill pill--blue"
                            title="A receipt is attached"
                          >
                            <Receipt size={11} aria-hidden="true" />
                            Receipt
                          </span>
                        ) : null}
                      </div>
                      <div className="cell-meta">{formatDate(tx.date)}</div>
                    </td>
                    <td>
                      <CategoryCell transaction={tx} categories={categoryOptions} />
                    </td>
                    <td className="cell-meta">{tx.account}</td>
                    <td>
                      <TagsCell
                        transaction={tx}
                        onAdd={() => setTagModalFor(tx)}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span
                        className={`amount amount--${
                          tx.type === "income" ? "income" : "expense"
                        }`}
                      >
                        {signedMoney(tx.amount, tx.type)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setEditTarget(tx)}
                        aria-label={`Edit transaction ${tx.merchant} on ${formatDate(tx.date)}`}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setDeleteTarget(tx)}
                        aria-label={`Delete transaction ${tx.merchant} on ${formatDate(tx.date)}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tx-list">
            {rows.map((tx) => (
              <article
                className={`tx-card ${selected.has(tx.id) ? "tx-card--selected" : ""}`}
                key={tx.id}
              >
                <div className="tx-card__top">
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(tx.id)}
                      onChange={() => toggleOne(tx.id)}
                      aria-label={`Select ${tx.merchant} on ${formatDate(tx.date)}`}
                    />
                    <div style={{ minWidth: 0 }}>
                      <p className="list-row__title">{tx.merchant}</p>
                      <p className="list-row__meta">
                        {formatDate(tx.date)} · {tx.account}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`amount amount--${
                      tx.type === "income" ? "income" : "expense"
                    }`}
                  >
                    {signedMoney(tx.amount, tx.type)}
                  </span>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <CategoryCell transaction={tx} categories={categoryOptions} />
                  {tx.receipt ? (
                    <span className="pill pill--blue">
                      <Receipt size={11} aria-hidden="true" />
                      Receipt
                    </span>
                  ) : null}
                </div>

                <TagsCell transaction={tx} onAdd={() => setTagModalFor(tx)} />

                <div className="row row--between">
                  <span className="cell-meta">Source: {tx.source}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setEditTarget(tx)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setDeleteTarget(tx)}
                      aria-label={`Delete ${tx.merchant}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}

      {editTarget ? (
        <AddEntryModal
          key={editTarget.id}
          transaction={editTarget}
          onClose={() => setEditTarget(null)}
        />
      ) : null}

      {tagModalFor ? (
        <TagOnlyModal
          transaction={tagModalFor}
          onClose={() => setTagModalFor(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete this transaction?"
          body={`${deleteTarget.merchant} · ${formatDate(deleteTarget.date)} · ${money(
            deleteTarget.amount,
          )}. This cannot be undone.`}
          confirmLabel="Delete transaction"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {bulkAction === "category" ? (
        <BulkCategoryModal
          count={selectedRows.length}
          categories={categoryOptions}
          busy={bulkBusy}
          onClose={() => setBulkAction(null)}
          onChoose={(next) => void bulkSetCategory(next)}
        />
      ) : null}

      {bulkAction === "tag" ? (
        <BulkTagModal
          count={selectedRows.length}
          allTags={state.tags}
          busy={bulkBusy}
          onClose={() => setBulkAction(null)}
          onSave={(tags) => void bulkAddTags(tags)}
        />
      ) : null}

      {bulkAction === "delete" ? (
        <ConfirmDialog
          title={`Delete ${selectedRows.length} transaction${selectedRows.length === 1 ? "" : "s"}?`}
          body="This cannot be undone."
          confirmLabel="Delete"
          busy={bulkBusy}
          onCancel={() => setBulkAction(null)}
          onConfirm={() => void bulkDelete()}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------- inline category editing */

function CategoryCell({
  transaction,
  categories,
}: {
  transaction: Transaction;
  categories: string[];
}) {
  const { updateTransaction, notify } = usePocketLedger();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  async function choose(next: string) {
    setOpen(false);
    if (next === transaction.category) return;
    setSaving(true);
    try {
      await updateTransaction(transaction.id, { category: next });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "That category change was not saved.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dropdown">
      <button
        type="button"
        className={`category-button ${
          transaction.category === "Needs review" ? "category-button--review" : ""
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Category for ${transaction.merchant}: ${transaction.category}. Change it.`}
        onClick={() => setOpen((value) => !value)}
        disabled={saving}
      >
        {saving ? <span className="spinner" /> : null}
        {transaction.category}
      </button>

      {open ? (
        <Modal
          title="Category"
          subtitle={`${transaction.merchant} · ${formatDate(transaction.date)}`}
          onClose={close}
          compact
        >
          <ul className="picker" role="listbox" aria-label="Choose a category">
            {categories.map((name) => {
              const selected = name === transaction.category;
              return (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="picker__item"
                    onClick={() => void choose(name)}
                  >
                    <span style={{ flex: 1 }}>{name}</span>
                    {selected ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- inline tag editing */

function TagsCell({
  transaction,
  onAdd,
}: {
  transaction: Transaction;
  onAdd: () => void;
}) {
  const { updateTransaction, notify } = usePocketLedger();
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(tag: string) {
    setBusy(tag);
    try {
      await updateTransaction(transaction.id, {
        tags: transaction.tags.filter((t) => t !== tag),
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That tag was not removed.",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tag-cell">
      {transaction.tags.map((tag) => (
        <span className="tag-pill" key={tag}>
          {tag}
          <button
            type="button"
            className="tag-pill__remove"
            onClick={() => void remove(tag)}
            disabled={busy === tag}
            aria-label={`Remove tag ${tag}`}
          >
            {busy === tag ? (
              <span className="spinner" style={{ width: 12, height: 12 }} />
            ) : (
              <X size={13} aria-hidden="true" />
            )}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="tag-add"
        onClick={onAdd}
        aria-label={`Add a tag to ${transaction.merchant}`}
        title="Add a tag"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Tags only — this dialog never asks for a category. */
function TagOnlyModal({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const state = useAppState();
  const { updateTransaction, notify } = usePocketLedger();
  const [tags, setTags] = useState<string[]>(transaction.tags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = JSON.stringify(tags) !== JSON.stringify(transaction.tags);
  const { requestClose, discardPrompt } = useConfirmClose(isDirty, onClose);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateTransaction(transaction.id, { tags });
      notify("Tags saved.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Those tags were not saved.");
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      title="Edit tags"
      subtitle={`${transaction.merchant} · ${formatDate(transaction.date)}`}
      onClose={requestClose}
      footer={
        <>
          <button type="button" className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save tags"}
          </button>
        </>
      }
    >
      {error ? <Notice kind="error">{error}</Notice> : null}
      <TagPicker
        allTags={state.tags}
        selected={tags}
        onChange={setTags}
        idPrefix={`tags-${transaction.id}`}
      />
    </Modal>
    {discardPrompt}
    </>
  );
}

/* ============================================================= bulk actions */

function BulkCategoryModal({
  count,
  categories,
  busy,
  onClose,
  onChoose,
}: {
  count: number;
  categories: string[];
  busy: boolean;
  onClose: () => void;
  onChoose: (category: string) => void;
}) {
  return (
    <Modal
      title={`Set category for ${count} transaction${count === 1 ? "" : "s"}`}
      onClose={onClose}
    >
      <ul className="picker" role="listbox" aria-label="Choose a category">
        {categories.map((name) => (
          <li key={name}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="picker__item"
              disabled={busy}
              onClick={() => onChoose(name)}
            >
              <span style={{ flex: 1 }}>{name}</span>
              {busy ? <span className="spinner" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function BulkTagModal({
  count,
  allTags,
  busy,
  onClose,
  onSave,
}: {
  count: number;
  allTags: Tag[];
  busy: boolean;
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);

  return (
    <Modal
      title={`Add tags to ${count} transaction${count === 1 ? "" : "s"}`}
      subtitle="These are added alongside whatever tags each transaction already has."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || tags.length === 0}
            onClick={() => onSave(tags)}
          >
            {busy ? <Spinner label="Saving" /> : "Add tags"}
          </button>
        </>
      }
    >
      <TagPicker
        allTags={allTags}
        selected={tags}
        onChange={setTags}
        idPrefix="bulk-tags"
      />
    </Modal>
  );
}
