"use client";

import { useRef, useState } from "react";

/**
 * The always-present blank line at the bottom of every category.
 *
 * There is no "Add a line" button per category, because a button opens a form
 * and a form is a decision to make before you have made the one you came to
 * make. A row that is already there, already in the right category, with a
 * cursor in it, costs one keystroke and a return — which is what adding a row to
 * a spreadsheet costs, and this page has to beat a spreadsheet.
 *
 * Enter creates and clears, keeping focus in the field so a list of eight things
 * can be typed without touching the mouse. Blur creates too, so a name typed and
 * then abandoned for another part of the page is not silently thrown away.
 */
export function NewItemRow(props: {
  categoryName: string;
  colSpan: number;
  disabled: boolean;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setName("");
    props.onCreate(trimmed);
  }

  return (
    <tr className="border-b border-[#f1f0ea] last:border-0">
      <td className="px-4 py-2" colSpan={props.colSpan}>
        <input
          ref={input}
          value={name}
          disabled={props.disabled}
          aria-label={`Add a line to ${props.categoryName}`}
          placeholder="+ Add a line"
          onChange={(event) => setName(event.target.value)}
          onBlur={submit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
              input.current?.focus();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setName("");
              event.currentTarget.blur();
            }
          }}
          className="w-[240px] max-w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] text-[#4a5147] outline-none transition-colors duration-200 hover:border-[#dddbd0] focus:border-olive focus:bg-white motion-reduce:transition-none"
        />
      </td>
    </tr>
  );
}
