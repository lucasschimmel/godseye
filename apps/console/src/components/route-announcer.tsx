import { useEffect, useRef, useState } from "react";
import {
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
    // A bare live region (no role): a second role="status" element would make every page's own status
    // message ambiguous for assistive technology and for tests that look for it.
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-route-announcer>
      {message}
    </div>
  );
}
