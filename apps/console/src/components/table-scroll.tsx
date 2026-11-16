import type { ReactNode } from "react";

/** A wide table that scrolls sideways on narrow screens; keyboard users must be able to focus it. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      className="headroom-table-wrap"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard reachable (WCAG 2.1.1)
      tabIndex={0}
    >
      {children}
    </section>
  );
}
