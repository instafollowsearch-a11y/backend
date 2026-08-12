/**
 * Allowed Stripe price IDs for this backend's Stripe mode (test vs live).
 * Set STRIPE_PRICE_* in env to match STRIPE_SECRET_KEY mode.
 */

const DEFAULT_TEST_PRICES = {
  basic: 'price_1S5rhNAseffRTW6hXg7koHU2',
  premium: 'price_1S5rhwAseffRTW6hxOU8TEGD',
  pro: 'price_1S5rj7AseffRTW6hH285ofSW',
};

const DEFAULT_LIVE_PRICES = {
  basic: 'price_1S0PJVAseffRTW6hDZI18DZG',
  premium: 'price_1S0PKXAseffRTW6hy3qVkkgm',
  pro: 'price_1S5rY5AseffRTW6hc302fdww',
};

const isTestKey = () =>
  String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test');

export const getStripePriceMap = () => {
  const defaults = isTestKey() ? DEFAULT_TEST_PRICES : DEFAULT_LIVE_PRICES;
  return {
    basic: process.env.STRIPE_PRICE_BASIC || defaults.basic,
    premium: process.env.STRIPE_PRICE_PREMIUM || defaults.premium,
    pro: process.env.STRIPE_PRICE_PRO || defaults.pro,
  };
};

export const getAllowedPriceIds = () => {
  const map = getStripePriceMap();
  return new Set(Object.values(map).filter(Boolean));
};

/**
 * @param {string} priceId
 * @returns {{ ok: boolean, plan?: string, error?: string }}
 */
export const resolvePlanFromPriceId = (priceId) => {
  if (!priceId) {
    return { ok: false, error: 'Price Id is required' };
  }
  const map = getStripePriceMap();
  const entry = Object.entries(map).find(([, id]) => id === priceId);
  if (!entry) {
    return {
      ok: false,
      error: 'Invalid price for this Stripe mode. Refresh the page and try again.',
    };
  }
  return { ok: true, plan: entry[0] };
};

export const getSearchesLimitForPlan = (plan) => {
  if (plan === 'pro') return 1000;
  if (plan === 'premium') return 200;
  return 50;
};
