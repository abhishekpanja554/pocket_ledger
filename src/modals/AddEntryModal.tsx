import { Paperclip } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { Transaction, TxType } from "../../shared/types";
import { TagPicker } from "../components/TagPicker";
import { Field, Modal, Notice, Spinner, useConfirmClose } from "../components/ui";
import { formatDate, todayISO } from "../lib/format";
import { usePocketLedger } from "../store";

/** Managed list, with the row's own value appended when it is missing. */
function withCurrent(list: string[], current?: string): string[] {
  if (!current) return list;
  return list.some((item) => item.toLowerCase() === current.toLowerCase())
    ? list
    : [...list, current];
}

/**
 * Add or edit one transaction.
 *
 * Adding starts blank except the date (today) — nothing is ever prefilled with
 * an invented amount or merchant. Passing `transaction` switches the same form
 * to editing that row.
 */
export function AddEntryModal({
  onClose,
  transaction,
}: {
  onClose: () => void;
  transaction?: Transaction;
}) {
  const { state, addTransactions, updateTransaction, uploadDocuments, notify } =
    usePocketLedger();
  const isEdit = Boolean(transaction);
  const ids = {
    amount: useId(),
    merchant: useId(),
    date: useId(),
    category: useId(),
    account: useId(),
    receipt: useId(),
  };

  const settings = state?.settings;

  // Imports create accounts and categories straight from the statement, so an
  // existing transaction can carry a name that is not in the managed lists.
  // Include its current values, otherwise editing would silently reassign them.
  const categories = withCurrent(settings?.categories ?? [], transaction?.category);
  const accounts = withCurrent(settings?.accounts ?? [], transaction?.account);

  const [type, setType] = useState<TxType>(transaction?.type ?? "expense");
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : "",
  );
  const [merchant, setMerchant] = useState(transaction?.merchant ?? "");
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [category, setCategory] = useState(
    transaction?.category ?? categories[0] ?? "Needs review",
  );
  const [account, setAccount] = useState(
    transaction?.account ?? accounts[0] ?? "",
  );
  const [tags, setTags] = useState<string[]>(transaction?.tags ?? []);
  const [hasReceipt, setHasReceipt] = useState(transaction?.receipt ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const noAccounts = accounts.length === 0;

  const isDirty =
    amount !== (transaction ? String(transaction.amount) : "") ||
    merchant !== (transaction?.merchant ?? "") ||
    date !== (transaction?.date ?? todayISO()) ||
    category !== (transaction?.category ?? categories[0] ?? "Needs review") ||
    account !== (transaction?.account ?? accounts[0] ?? "") ||
    type !== (transaction?.type ?? "expense") ||
    hasReceipt !== (transaction?.receipt ?? false) ||
    file !== null ||
    JSON.stringify(tags) !== JSON.stringify(transaction?.tags ?? []);

  const { requestClose, discardPrompt } = useConfirmClose(isDirty, onClose);

  function validate(): boolean {
    const next: Record<string, string> = {};
    const parsedAmount = Number(amount);
    if (!amount.trim()) next.amount = "Enter an amount.";
    else if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
      next.amount = "Amount must be greater than 0.";
    if (!merchant.trim()) next.merchant = "Enter a merchant or source.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = "Choose a valid date.";
    if (!noAccounts && !account) next.account = "Choose an account.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSaving(true);

    if (isEdit && transaction) {
      try {
        // Only the receipt flag needs the new file; the rest is a plain patch.
        let receiptStored = transaction.receipt;
        if (hasReceipt && file) {
          const upload = await uploadDocuments([file], "stored");
          if (upload.errors.length) {
            setFormError(`The receipt was not stored: ${upload.errors[0]}`);
            setSaving(false);
            return;
          }
          receiptStored = true;
        } else if (!hasReceipt) {
          receiptStored = false;
        }

        await updateTransaction(transaction.id, {
          date,
          merchant: merchant.trim(),
          amount: Number(amount),
          type,
          category,
          account: account || "Imported account",
          tags,
          receipt: receiptStored,
        });
        notify("Transaction updated.");
        onClose();
      } catch (error) {
        setFormError(
          error instanceof Error
            ? error.message
            : "The changes could not be saved.",
        );
        setSaving(false);
      }
      return;
    }

    try {
      const result = await addTransactions([
        {
          date,
          merchant: merchant.trim(),
          amount: Number(amount),
          type,
          category,
          account: account || "Imported account",
          tags,
          receipt: hasReceipt && Boolean(file),
          source: "manual",
        },
      ]);

      if (result.inserted === 0) {
        setFormError(
          result.duplicates > 0
            ? "That transaction already exists — same date, merchant, amount and account."
            : (result.errors[0] ?? "The transaction could not be saved."),
        );
        setSaving(false);
        return;
      }

      if (hasReceipt && file) {
        const upload = await uploadDocuments([file], "stored");
        if (upload.errors.length) {
          notify(
            `Transaction saved. The receipt was not stored: ${upload.errors[0]}`,
            "error",
          );
        } else {
          notify("Transaction and receipt saved.");
        }
      } else {
        notify("Transaction saved.");
      }
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The transaction could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      title={isEdit ? "Edit transaction" : "Add entry"}
      subtitle={
        isEdit && transaction
          ? `Saved ${formatDate(transaction.date)} · from ${transaction.source}`
          : "Record one expense or income transaction."
      }
      onClose={requestClose}
      footer={
        <>
          <button type="button" className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="add-entry-form"
            className="btn btn--primary"
            disabled={saving}
          >
            {saving ? (
              <Spinner label="Saving" />
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Save transaction"
            )}
          </button>
        </>
      }
    >
      <form id="add-entry-form" onSubmit={submit} className="stack" noValidate>
        {formError ? <Notice kind="error">{formError}</Notice> : null}

        <div className="segmented" role="group" aria-label="Transaction type">
          <button
            type="button"
            aria-pressed={type === "expense"}
            onClick={() => setType("expense")}
          >
            Expense
          </button>
          <button
            type="button"
            aria-pressed={type === "income"}
            onClick={() => setType("income")}
          >
            Income
          </button>
        </div>

        <div className="grid grid--2">
          <Field label="Amount" error={errors.amount} htmlFor={ids.amount}>
            <input
              id={ids.amount}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>

          <Field label="Date" error={errors.date} htmlFor={ids.date}>
            <input
              id={ids.date}
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label={type === "income" ? "Source" : "Merchant"}
          error={errors.merchant}
          htmlFor={ids.merchant}
        >
          <input
            id={ids.merchant}
            className="input"
            placeholder={type === "income" ? "Where it came from" : "Where you spent"}
            value={merchant}
            maxLength={200}
            onChange={(event) => setMerchant(event.target.value)}
          />
        </Field>

        <div className="grid grid--2">
          <Field label="Category" htmlFor={ids.category}>
            <select
              id={ids.category}
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.length === 0 ? (
                <option value="Needs review">Needs review</option>
              ) : (
                categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </Field>

          <Field
            label="Account"
            error={errors.account}
            hint={
              noAccounts ? "Add an account in Settings to enable this." : undefined
            }
            htmlFor={ids.account}
          >
            <select
              id={ids.account}
              className="select"
              value={account}
              disabled={noAccounts}
              onChange={(event) => setAccount(event.target.value)}
            >
              {noAccounts ? (
                <option value="">Add an account in Settings</option>
              ) : (
                accounts.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </Field>
        </div>

        <Field label="Tags">
          <TagPicker
            allTags={state?.tags ?? []}
            selected={tags}
            onChange={setTags}
            idPrefix="add-entry"
          />
        </Field>

        <label className="checkbox" htmlFor={ids.receipt}>
          <input
            id={ids.receipt}
            type="checkbox"
            checked={hasReceipt}
            onChange={(event) => {
              setHasReceipt(event.target.checked);
              if (!event.target.checked) setFile(null);
            }}
          />
          I have a receipt to attach
        </label>

        {hasReceipt ? (
          <Field
            label="Receipt file"
            hint={
              isEdit && transaction?.receipt
                ? "A receipt is already attached. Choosing a file adds another."
                : "Stored as the original file, up to 20 MB."
            }
          >
            <div className="row" style={{ gap: 10 }}>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                accept="image/*,application/pdf,.csv,.xlsx,.txt"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip size={16} aria-hidden="true" />
                Choose file
              </button>
              <span className="field__hint">
                {file ? file.name : "No file chosen"}
              </span>
            </div>
          </Field>
        ) : null}
      </form>
    </Modal>
    {discardPrompt}
    </>
  );
}
