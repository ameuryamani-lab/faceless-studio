// A side-panel card whose body folds away. The open/closed choice is remembered per section in this browser only.

import { useState, type ReactNode } from "react";

const KEY = "office.sp.";

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(KEY + id);
    return v === null ? fallback : v === "open";
  } catch {
    return fallback;
  }
}

function saveOpen(id: string, open: boolean) {
  try {
    window.localStorage.setItem(KEY + id, open ? "open" : "closed");
  } catch {
    // Storage refused (private window): the section still folds, it just forgets.
  }
}

export function Section({ id, title, count, badge, defaultOpen = true, children }: { id: string; title: string; count?: number; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const toggle = () =>
    setOpen((o) => {
      saveOpen(id, !o);
      return !o;
    });
  return (
    <section className={`sp-section${open ? "" : " is-closed"}`}>
      <h2>
        <button type="button" className="sp-fold" aria-expanded={open} aria-controls={`sp-${id}`} onClick={toggle}>
          <span className="sp-chev" aria-hidden="true" />
          {title}
          {count ? <span className="sp-count">{count}</span> : null}
          {badge}
        </button>
      </h2>
      {open ? <div id={`sp-${id}`}>{children}</div> : null}
    </section>
  );
}
