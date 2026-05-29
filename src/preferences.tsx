import React from "react";
import i18n from "i18next";

export type ThemePreference = "dark" | "light";
export type LanguagePreference = "zh-CN" | "en-US";
export type MarketColorPreference = "red-up" | "green-up";

export interface Preferences {
  theme: ThemePreference;
  language: LanguagePreference;
  marketColors: MarketColorPreference;
  resolvedTheme: "dark" | "light";
  resolvedLanguage: "zh-CN" | "en-US";
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: LanguagePreference) => void;
  setMarketColors: (marketColors: MarketColorPreference) => void;
  t: (key: string, options?: any) => string;
}

const STORAGE_KEY = "aurum-watch-preferences";

const PreferencesContext = React.createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>(() => loadPreferences().theme);
  const [language, setLanguageState] = React.useState<LanguagePreference>(() => loadPreferences().language);
  const [marketColors, setMarketColorsState] = React.useState<MarketColorPreference>(() => loadPreferences().marketColors);

  const resolvedTheme = theme;
  const resolvedLanguage = language;

  React.useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.marketColors = marketColors;
    document.documentElement.lang = resolvedLanguage;
    i18n.changeLanguage(resolvedLanguage);
  }, [resolvedTheme, resolvedLanguage, marketColors]);

  function persist(next: Partial<StoredPreferences>) {
    const current = loadPreferences();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...next }));
  }

  function setTheme(value: ThemePreference) {
    setThemeState(value);
    persist({ theme: value });
  }

  function setLanguage(value: LanguagePreference) {
    setLanguageState(value);
    persist({ language: value });
  }

  function setMarketColors(value: MarketColorPreference) {
    setMarketColorsState(value);
    persist({ marketColors: value });
  }

  const value: Preferences = {
    theme,
    language,
    marketColors,
    resolvedTheme,
    resolvedLanguage,
    setTheme,
    setLanguage,
    setMarketColors,
    t: (key, options) => i18n.t(key, options) as string
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = React.useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used within PreferencesProvider");
  return value;
}

interface StoredPreferences {
  theme: ThemePreference;
  language: LanguagePreference;
  marketColors: MarketColorPreference;
}

function loadPreferences(): StoredPreferences {
  const fallback: StoredPreferences = {
    theme: detectSystemTheme(),
    language: detectSystemLanguage(),
    marketColors: "red-up"
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<StoredPreferences> | null;
    let theme = parsed?.theme;
    let language = parsed?.language;
    let needsSave = false;

    if (!theme || theme === ("system" as any)) {
      theme = detectSystemTheme();
      needsSave = true;
    }
    if (!language || language === ("system" as any)) {
      language = detectSystemLanguage();
      needsSave = true;
    }
    const marketColors = parsed?.marketColors ?? fallback.marketColors;
    if (parsed?.marketColors !== marketColors) {
      needsSave = true;
    }

    const loaded = { theme, language, marketColors };
    if (needsSave) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    }
    return loaded;
  } catch {
    return fallback;
  }
}

function detectSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function detectSystemLanguage(): "zh-CN" | "en-US" {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
