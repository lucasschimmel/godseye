import { useCallback, useEffect, useState } from "react";

export type ThemeName = "dark" | "light";
const STORAGE_KEY = "godseye-theme";

function readStoredTheme(): ThemeName {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    // Storage can be blocked (private mode); dark stays the default.
    return "dark";
  }
}

/** Per-browser theme preference; dark is the default and the server-rendered state. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>("dark");
  useEffect(() => setTheme(readStoredTheme()), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // The choice still applies for this page view.
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}
