/** Landmark that receives focus after a client-side navigation. Matches the skip-link target. */
export const MAIN_LANDMARK_ID = "main-content";

export const DOCUMENT_TITLE_SUFFIX = "G.O.D.S.E.Y.E";

/** Accessible name of the live region that announces page changes. */
export const ANNOUNCER_LABEL = "Navigation";

/** Title shown for routes that are not listed in the main navigation (project detail pages). */
export const FALLBACK_PAGE_LABEL = "Projet";

/** Text read by assistive technology once a navigation has completed. */
export function pageAnnouncement(label: string): string {
  return `Page : ${label}`;
}

/** Browser tab title; each page gets a distinct one (WCAG 2.4.2). */
export function pageTitle(label: string): string {
  return `${label} — ${DOCUMENT_TITLE_SUFFIX}`;
}

interface FocusTarget {
  focus(options?: { preventScroll?: boolean }): void;
}

interface FocusRoot {
  getElementById(id: string): FocusTarget | null;
}

/**
 * Moves keyboard focus to the main landmark so the next Tab starts inside the new page rather than
 * on the previous link. Returns false when the landmark is missing.
 */
export function focusMainLandmark(root: FocusRoot): boolean {
  const main = root.getElementById(MAIN_LANDMARK_ID);
  if (!main) return false;
  main.focus({ preventScroll: true });
  return true;
}

/**
 * A navigation happened only when the path changed after the first render; the initial page load is
 * announced by the browser and must not steal focus from the skip link.
 */
export function isNavigation(previousPath: string | null, nextPath: string): boolean {
  return previousPath !== null && previousPath !== nextPath;
}
