import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "pocket-ledger-theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : "system";
}

const THEME_COLOR = { light: "#1E2340", dark: "#14151d" } as const;
const OVERRIDE_META_ID = "theme-color-override";

/**
 * The mobile browser chrome color (address bar) is normally driven by the
 * two static `<meta name="theme-color" media="...">` tags in index.html,
 * which follow system preference. A manual light/dark choice needs to win
 * over that, so this adds one more meta tag with no media qualifier — those
 * always match, overriding the system-driven pair — and removes it again for
 * "system" so the static tags take back over.
 */
function syncThemeColorMeta(theme: Theme) {
  const existing = document.getElementById(OVERRIDE_META_ID);
  if (theme === "system") {
    existing?.remove();
    return;
  }
  const meta =
    existing instanceof HTMLMetaElement
      ? existing
      : document.createElement("meta");
  meta.id = OVERRIDE_META_ID;
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", THEME_COLOR[theme]);
  if (!existing) document.head.appendChild(meta);
}

/**
 * Applies `theme` to the document root as a `data-theme` attribute. "system"
 * removes the attribute entirely so the `prefers-color-scheme` media query in
 * styles.css takes over — it is never written as a literal attribute value.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  syncThemeColorMeta(theme);
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/**
 * The inline script in index.html already applies the stored theme before
 * first paint (avoiding a flash of the wrong theme). This hook just gives
 * components a reactive value to render a toggle against.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function update(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  return [theme, update];
}
