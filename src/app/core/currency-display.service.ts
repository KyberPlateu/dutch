import { Injectable, inject } from '@angular/core';
import Decimal from 'decimal.js';
import { AppPreferencesService } from './app-preferences.service';
import { currencyMinorUnits } from './event-sourcing.service';
import { sampleFxRateToUsd } from './fx-rates';

const USD_MICROS_PER_UNIT = 1_000_000;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  JPY: '¥',
};

@Injectable({
  providedIn: 'root',
})
export class CurrencyDisplayService {
  private readonly preferences = inject(AppPreferencesService);

  readonly currency = this.preferences.globalCurrency;

  formatUsdMicros(amountUsdMicros: number): string {
    const currency = this.currency();
    const amount = usdMicrosToCurrencyAmount(amountUsdMicros, currency);
    const scale = currencyMinorUnits(currency);
    const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;

    return `${symbol}${amount.toFixed(scale)}`;
  }
}

function usdMicrosToCurrencyAmount(amountUsdMicros: number, currency: string): Decimal {
  return new Decimal(amountUsdMicros)
    .div(USD_MICROS_PER_UNIT)
    .div(sampleFxRateToUsd(currency));
}
