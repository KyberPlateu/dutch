export const SAMPLE_FX_RATES_TO_USD: Record<string, string> = {
  USD: '1',
  EUR: '1.08',
  GBP: '1.27',
  INR: '0.012',
  JPY: '0.0064',
};

export function sampleFxRateToUsd(currency: string): string {
  const rate = SAMPLE_FX_RATES_TO_USD[currency.toUpperCase()];

  if (!rate) {
    throw new Error(`No sample FX rate configured for ${currency.toUpperCase()}.`);
  }

  return rate;
}
