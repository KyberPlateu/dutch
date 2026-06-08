import { computed, DestroyRef, Injectable, inject, signal } from '@angular/core';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY'] as const;
export const SUPPORTED_THEME_MODES = ['system', 'light', 'dark'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type ThemeMode = (typeof SUPPORTED_THEME_MODES)[number];
export type EffectiveTheme = Exclude<ThemeMode, 'system'>;

const GLOBAL_CURRENCY_KEY = 'dutch.globalCurrency';
const THEME_MODE_KEY = 'dutch.themeMode';
const DEFAULT_GLOBAL_CURRENCY: SupportedCurrency = 'USD';
const DEFAULT_THEME_MODE: ThemeMode = 'system';

@Injectable({
  providedIn: 'root',
})
export class AppPreferencesService {
  private readonly globalCurrencySignal = signal<SupportedCurrency>(readStoredGlobalCurrency());
  private readonly themeModeSignal = signal<ThemeMode>(readStoredThemeMode());
  private readonly systemThemeSignal = signal<EffectiveTheme>(readSystemTheme());

  readonly globalCurrency = this.globalCurrencySignal.asReadonly();
  readonly themeMode = this.themeModeSignal.asReadonly();
  readonly effectiveTheme = computed<EffectiveTheme>(() => {
    const mode = this.themeModeSignal();
    return mode === 'system' ? this.systemThemeSignal() : mode;
  });

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = (event: MediaQueryListEvent | MediaQueryList): void => {
      this.systemThemeSignal.set(event.matches ? 'dark' : 'light');
    };

    updateSystemTheme(mediaQuery);
    mediaQuery.addEventListener?.('change', updateSystemTheme);

    const destroyRef = injectDestroyRef();
    destroyRef?.onDestroy(() => {
      mediaQuery.removeEventListener?.('change', updateSystemTheme);
    });
  }

  setGlobalCurrency(currency: string): void {
    const normalized = currency.toUpperCase();

    if (!isSupportedCurrency(normalized)) {
      throw new Error(`Unsupported global currency: ${currency}`);
    }

    this.globalCurrencySignal.set(normalized);
    writeStoredGlobalCurrency(normalized);
  }

  setThemeMode(mode: string): void {
    const normalized = mode.toLowerCase();

    if (!isSupportedThemeMode(normalized)) {
      throw new Error(`Unsupported theme mode: ${mode}`);
    }

    this.themeModeSignal.set(normalized);
    writeStoredThemeMode(normalized);
  }
}

function readStoredGlobalCurrency(): SupportedCurrency {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_GLOBAL_CURRENCY;
  }

  try {
    const stored = localStorage.getItem(GLOBAL_CURRENCY_KEY)?.toUpperCase();
    return stored && isSupportedCurrency(stored) ? stored : DEFAULT_GLOBAL_CURRENCY;
  } catch {
    return DEFAULT_GLOBAL_CURRENCY;
  }
}

function writeStoredGlobalCurrency(currency: SupportedCurrency): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(GLOBAL_CURRENCY_KEY, currency);
  } catch {
    // Private browsing and embedded webviews can reject storage writes.
  }
}

function isSupportedCurrency(currency: string): currency is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency);
}

function readStoredThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_THEME_MODE;
  }

  try {
    const stored = localStorage.getItem(THEME_MODE_KEY)?.toLowerCase();
    return stored && isSupportedThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

function writeStoredThemeMode(mode: ThemeMode): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    // Private browsing and embedded webviews can reject storage writes.
  }
}

function readSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isSupportedThemeMode(mode: string): mode is ThemeMode {
  return SUPPORTED_THEME_MODES.includes(mode as ThemeMode);
}

function injectDestroyRef(): DestroyRef | null {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
}
