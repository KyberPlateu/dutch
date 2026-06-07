import { Injectable, signal } from '@angular/core';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const GLOBAL_CURRENCY_KEY = 'dutch.globalCurrency';
const DEFAULT_GLOBAL_CURRENCY: SupportedCurrency = 'USD';

@Injectable({
  providedIn: 'root',
})
export class AppPreferencesService {
  private readonly globalCurrencySignal = signal<SupportedCurrency>(readStoredGlobalCurrency());

  readonly globalCurrency = this.globalCurrencySignal.asReadonly();

  setGlobalCurrency(currency: string): void {
    const normalized = currency.toUpperCase();

    if (!isSupportedCurrency(normalized)) {
      throw new Error(`Unsupported global currency: ${currency}`);
    }

    this.globalCurrencySignal.set(normalized);
    writeStoredGlobalCurrency(normalized);
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
