import { cloneElement, type ReactElement, useId } from "react";

interface Props {
  /** Why the wrapped control is disabled; null or undefined when it is enabled or merely busy. */
  reason?: string | null;
  children: ReactElement<{ "aria-describedby"?: string }>;
}

/**
 * Explains a disabled control. Disabled buttons do not receive hover or focus, so the explanation lives
 * on a wrapper (tooltip) and is also exposed to assistive technology through aria-describedby.
 */
export function WithReason({ reason, children }: Props) {
  const id = useId();
  if (!reason) return children;
  return (
    <span className="reason-wrap" title={reason} data-reason={reason}>
      {cloneElement(children, { "aria-describedby": id })}
      <span id={id} className="sr-only">
        {reason}
      </span>
    </span>
  );
}
