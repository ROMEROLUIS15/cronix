/**
 * bcv-rate.ts — BCV Exchange Rate Wrapper
 *
 * Fetches the official BCV (Banco Central de Venezuela) USD→VES rate
 * from ve.dolarapi.com and applies a configurable markup for Pago Móvil pricing.
 *
 * Exposes:
 *  - BCV_MARKUP_PERCENT   → 0.30 (30% markup over official rate)
 *  - fetchBcvRate()       → fetches rate with in-memory cache (5 min TTL)
 *  - calculateBsAmount()  → converts USD to VES with markup applied
 *
 * Dependency isolation: if the API changes, only this file needs updating.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** 30% markup over official BCV rate to approximate the parallel/real market rate */
export const BCV_MARKUP_PERCENT = 0.30;

/** Venezuela timezone — used to detect Venezuelan businesses */
export const VENEZUELA_TIMEZONE = 'America/Caracas';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BcvRateResult {
  /** Official BCV rate (Bs. per 1 USD) */
  bcvRate: number;
  /** Rate with markup applied (Bs. per 1 USD) */
  rateWithMarkup: number;
  /** ISO timestamp of the last API update */
  updatedAt: string;
}

interface DolarApiEntry {
  fuente: string;
  promedio: number | null;
  fechaActualizacion: string;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedRate: BcvRateResult | null = null;
let cacheTimestamp = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches the current BCV official rate from ve.dolarapi.com.
 * Results are cached in memory for 5 minutes to avoid excessive API calls.
 *
 * @returns Rate data with markup, or null if the API is unreachable.
 */
export async function fetchBcvRate(): Promise<BcvRateResult | null> {
  // Return cached value if still fresh
  if (cachedRate && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRate;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch('https://ve.dolarapi.com/v1/dolares', {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return cachedRate; // Return stale cache on HTTP error

    const data: DolarApiEntry[] = await res.json();
    const oficial = data.find((d) => d.fuente === 'oficial');

    if (!oficial?.promedio || oficial.promedio <= 0) {
      return cachedRate; // Invalid data — keep stale cache
    }

    const result: BcvRateResult = {
      bcvRate: oficial.promedio,
      rateWithMarkup: oficial.promedio * (1 + BCV_MARKUP_PERCENT),
      updatedAt: oficial.fechaActualizacion,
    };

    // Update cache
    cachedRate = result;
    cacheTimestamp = Date.now();

    return result;
  } catch {
    // Network error, timeout, etc. — return stale cache or null
    return cachedRate;
  }
}

/**
 * Converts a USD amount to VES using the given rate (with markup already applied).
 * Returns the amount formatted as a string with 2 decimal places and thousands separators.
 *
 * @param amountUsd - Amount in USD (e.g. 10 for Pro plan)
 * @param rateWithMarkup - BCV rate with markup (Bs. per 1 USD)
 */
export function calculateBsAmount(amountUsd: number, rateWithMarkup: number): string {
  const totalBs = amountUsd * rateWithMarkup;
  return totalBs.toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Checks if a business timezone corresponds to Venezuela.
 */
export function isVenezuelanBusiness(timezone: string | null | undefined): boolean {
  return timezone === VENEZUELA_TIMEZONE;
}
