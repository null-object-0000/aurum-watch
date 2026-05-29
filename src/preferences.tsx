import React from "react";
import i18n from "i18next";

export type ThemePreference = "system" | "dark" | "light";
export type LanguagePreference = "system" | "zh-CN" | "en-US";
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
  const [systemTheme, setSystemTheme] = React.useState<"dark" | "light">(() => detectSystemTheme());
  const [systemLanguage, setSystemLanguage] = React.useState<"zh-CN" | "en-US">(() => detectSystemLanguage());

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystemTheme(detectSystemTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;
  const resolvedLanguage = language === "system" ? systemLanguage : language;

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
    if (value === "system") setSystemLanguage(detectSystemLanguage());
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
    theme: "system",
    language: "system",
    marketColors: "red-up"
  };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredPreferences> | null;
    return { ...fallback, ...parsed };
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
