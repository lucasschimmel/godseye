import { useEffect, useRef, useState } from "react";
import {
  ANNOUNCER_LABEL,
  focusMainLandmark,
  isNavigation,
  pageAnnouncement,
  pageTitle,
} from "@/lib/route-announcement";

/**
 * Keeps keyboard and screen-reader users oriented after a client-side navigation: updates the tab
 * title, moves focus to the main landmark and announces the new page in a polite live region.
 */
export function RouteAnnouncer({ pathname, label }: { pathname: string; label: string }) {
  const previousPath = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const navigated = isNavigation(previousPath.current, pathname);
    previousPath.current = pathname;
    document.title = pageTitle(label);
    if (!navigated) return;
    focusMainLandmark(document);
    setMessage(pageAnnouncement(label));
  }, [pathname, label]);
  return (
    <div className="sr-only" role="status" aria-label={ANNOUNCER_LABEL}>
      {message}
    </div>
  );
}
