import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppPreferencesService } from './app-preferences.service';

describe('AppPreferencesService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('defaults the global currency to USD', () => {
    const service = TestBed.inject(AppPreferencesService);

    expect(service.globalCurrency()).toBe('USD');
  });

  it('persists the selected global currency', () => {
    const service = TestBed.inject(AppPreferencesService);

    service.setGlobalCurrency('eur');
    TestBed.resetTestingModule();

    expect(TestBed.inject(AppPreferencesService).globalCurrency()).toBe('EUR');
  });

  it('rejects unsupported global currencies', () => {
    const service = TestBed.inject(AppPreferencesService);

    expect(() => service.setGlobalCurrency('BTC')).toThrow(/Unsupported global currency/);
    expect(service.globalCurrency()).toBe('USD');
  });
});
