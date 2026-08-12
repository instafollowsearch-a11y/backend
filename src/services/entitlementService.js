import { Op } from 'sequelize';
import Stripe from 'stripe';
import Subscription from '../models/Subscription.js';
import { getSubscription } from './stripeService.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PLAN_DISPLAY = {
  basic: 'Basic Plan',
  premium: 'Premium Plan',
  pro: 'Pro Plan',
};

/**
 * Active Postgres subscription row (comps / webhook).
 * @param {string} userId
 */
export const getActiveDbSubscriptionRow = async (userId) => {
  if (!userId) return null;
  return Subscription.findOne({
    where: {
      userId,
      status: 'active',
      endDate: { [Op.gt]: new Date() },
    },
    order: [['endDate', 'DESC']],
  });
};

/**
 * Postgres-only active subscription check (comps / future webhook rows).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const hasActiveDbSubscription = async (userId) => {
  const row = await getActiveDbSubscriptionRow(userId);
  return Boolean(row);
};

/**
 * Map DB row to frontend-compatible subscription payload.
 */
export const mapDbRowToEntitlement = (row) => {
  if (!row) return null;
  const plan = row.plan || 'basic';
  return {
    status: 'active',
    active: true,
    name: PLAN_DISPLAY[plan] || `${plan} Plan`,
    plan,
    endDate: row.endDate,
    startDate: row.startDate,
    searchesLimit: row.searchesLimit,
    searchesUsed: row.searchesUsed,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripeCustomerId: row.stripeCustomerId,
    source: 'db',
  };
};

/**
 * Resolve UI entitlement: DB active first, then Stripe.
 * @param {import('../models/User.js').default} user
 */
export const resolveUserEntitlement = async (user) => {
  if (!user) {
    return { success: true, source: 'none', subscription: null };
  }

  const dbRow = await getActiveDbSubscriptionRow(user.id);
  if (dbRow) {
    return {
      success: true,
      source: 'db',
      subscription: mapDbRowToEntitlement(dbRow),
    };
  }

  if (user.stripeCustomerId) {
    try {
      const stripeResult = await getSubscription(user.stripeCustomerId);
      if (stripeResult?.success && stripeResult.data) {
        const data = stripeResult.data;
        const planFromName = String(data.name || data.plan || '')
          .toLowerCase()
          .match(/\b(basic|premium|pro)\b/);
        return {
          success: true,
          source: 'stripe',
          subscription: {
            ...data,
            active: true,
            status: data.status || 'active',
            plan: planFromName?.[1] || data.plan || 'premium',
            name: data.name || PLAN_DISPLAY.premium,
            source: 'stripe',
          },
        };
      }
    } catch (error) {
      console.error('Entitlement Stripe lookup failed:', error.message);
    }
  }

  return { success: true, source: 'none', subscription: null };
};

/**
 * Stripe active or trialing subscription for a customer id.
 * @param {string} stripeCustomerId
 * @returns {Promise<boolean>}
 */
export const hasActiveStripeSubscription = async (stripeCustomerId) => {
  if (!stripeCustomerId || !stripe) return false;
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 20,
    });
    return subscriptions.data.some(
      (sub) => sub.status === 'active' || sub.status === 'trialing'
    );
  } catch (error) {
    console.error('Stripe entitlement check failed:', error.message);
    return false;
  }
};

/**
 * Hybrid paid access until Issue 2/3 webhooks make Postgres the sole source of truth.
 * Allow if: admin role OR active DB sub OR active/trialing Stripe sub.
 * @param {import('../models/User.js').default} user
 * @returns {Promise<boolean>}
 */
export const assertUserHasPaidAccess = async (user) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (await hasActiveDbSubscription(user.id)) return true;
  if (user.stripeCustomerId) {
    return hasActiveStripeSubscription(user.stripeCustomerId);
  }
  return false;
};
