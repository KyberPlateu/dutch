import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppPreferencesService } from './app-preferences.service';
import { CurrencyDisplayService } from './currency-display.service';

describe('CurrencyDisplayService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('formats USD ledger amounts in the selected global currency', () => {
    const preferences = TestBed.inject(AppPreferencesService);
    const display = TestBed.inject(CurrencyDisplayService);

    preferences.setGlobalCurrency('INR');

    expect(display.formatUsdMicros(1_200_000)).toBe('₹100.00 INR');
  });

  it('respects currencies without decimal minor units', () => {
    const preferences = TestBed.inject(AppPreferencesService);
    const display = TestBed.inject(CurrencyDisplayService);

    preferences.setGlobalCurrency('JPY');

    expect(display.formatUsdMicros(6_400_000)).toBe('¥1000 JPY');
  });
});
