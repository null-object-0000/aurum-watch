import React from "react";

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
  t: (key: string) => string;
}

const STORAGE_KEY = "aurum-watch-preferences";

const dictionary: Record<string, Record<"zh-CN" | "en-US", string>> = {
  settings: { "zh-CN": "系统设置", "en-US": "Settings" },
  dashboard: { "zh-CN": "返回看板", "en-US": "Back to dashboard" },
  brandSubtitle: { "zh-CN": "舆情洞察 · 影响预测", "en-US": "Sentiment intelligence · impact forecast" },
  dataManagement: { "zh-CN": "数据管理", "en-US": "Data Management" },
  preferences: { "zh-CN": "显示偏好", "en-US": "Display Preferences" },
  theme: { "zh-CN": "主题", "en-US": "Theme" },
  language: { "zh-CN": "语言", "en-US": "Language" },
  marketColors: { "zh-CN": "涨跌颜色", "en-US": "Market Colors" },
  system: { "zh-CN": "跟随系统", "en-US": "System" },
  dark: { "zh-CN": "深色", "en-US": "Dark" },
  light: { "zh-CN": "浅色", "en-US": "Light" },
  redUp: { "zh-CN": "红涨绿跌", "en-US": "Red up, green down" },
  greenUp: { "zh-CN": "绿涨红跌", "en-US": "Green up, red down" }
};

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
    t: (key) => dictionary[key]?.[resolvedLanguage] ?? key
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
