import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import type { Tag } from "../../shared/types";

/**
 * Tag selection with simple add-new support. Creating a tag needs a name and
 * nothing else — no category, rule, colour or other metadata.
 */
export function TagPicker({
  allTags,
  selected,
  onChange,
  idPrefix = "tag",
}: {
  allTags: Tag[];
  selected: string[];
  onChange: (tags: string[]) => void;
  idPrefix?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedLower = new Set(selected.map((t) => t.toLowerCase()));

  function toggle(name: string) {
    if (selectedLower.has(name.toLowerCase())) {
      onChange(selected.filter((t) => t.toLowerCase() !== name.toLowerCase()));
    } else {
      onChange([...selected, name]);
    }
  }

  function addDraft() {
    const name = draft.trim();
    if (!name) {
      setError("Enter a tag name.");
      return;
    }
    if (name.length > 40) {
      setError("Keep tag names under 40 characters.");
      return;
    }
    if (selectedLower.has(name.toLowerCase())) {
      setError("That tag is already selected.");
      return;
    }
    onChange([...selected, name]);
    setDraft("");
    setError(null);
  }

  const available = allTags.filter(
    (tag) => !selectedLower.has(tag.name.toLowerCase()),
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="chip-row" aria-live="polite">
        {selected.length === 0 ? (
          <span className="field__hint">No tags selected yet.</span>
        ) : (
          selected.map((tag) => (
            <span className="tag-pill" key={tag}>
              {tag}
              <button
                type="button"
                className="tag-pill__remove"
                onClick={() => toggle(tag)}
                aria-label={`Remove tag ${tag}`}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))
        )}
      </div>

      {available.length > 0 ? (
        <div className="chip-row">
          {available.map((tag) => (
            <button
              type="button"
              key={tag.name}
              className="pill"
              onClick={() => toggle(tag.name)}
            >
              <Check size={12} aria-hidden="true" />
              {tag.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <input
          className="input"
          id={`${idPrefix}-new`}
          placeholder="New tag name"
          value={draft}
          maxLength={40}
          aria-label="New tag name"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
        />
        <button type="button" className="btn" onClick={addDraft}>
          <Plus size={16} aria-hidden="true" />
          Add
        </button>
      </div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
