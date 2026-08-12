import { Op } from 'sequelize';
import Subscription from '../models/Subscription.js';
import { getSearchesLimitForPlan } from './stripePriceConfig.js';

const VALID_PLANS = new Set(['basic', 'premium', 'pro']);

/**
 * Cancel all active local subscriptions for a user (no Stripe cancel).
 * @param {string} userId
 */
export const revokeLocalSubscriptions = async (userId) => {
  const [count] = await Subscription.update(
    { status: 'cancelled' },
    {
      where: {
        userId,
        status: 'active',
      },
    }
  );
  return count;
};

/**
 * Grant or replace local entitlement (admin comp). Does not touch Stripe.
 * @param {{ userId: string, plan: string, days?: number, endDate?: Date|string, searchesLimit?: number }} opts
 */
export const grantLocalSubscription = async ({
  userId,
  plan = 'premium',
  days = 30,
  endDate = null,
  searchesLimit = null,
}) => {
  if (!userId) throw new Error('userId is required');
  const normalizedPlan = String(plan || 'premium').toLowerCase();
  if (!VALID_PLANS.has(normalizedPlan)) {
    throw new Error('Invalid plan. Use basic, premium, or pro.');
  }

  await revokeLocalSubscriptions(userId);

  const resolvedEnd =
    endDate != null
      ? new Date(endDate)
      : new Date(Date.now() + Number(days || 30) * 24 * 60 * 60 * 1000);

  const limit =
    searchesLimit != null
      ? Number(searchesLimit)
      : getSearchesLimitForPlan(normalizedPlan);

  const row = await Subscription.create({
    userId,
    plan: normalizedPlan,
    status: 'active',
    startDate: new Date(),
    endDate: resolvedEnd,
    searchesUsed: 0,
    searchesLimit: limit,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
  });

  return row;
};

/**
 * Extend an active local subscription endDate (or grant if none).
 */
export const extendLocalSubscription = async ({
  userId,
  plan = null,
  days = 30,
  endDate = null,
  searchesLimit = null,
}) => {
  const active = await Subscription.findOne({
    where: {
      userId,
      status: 'active',
      endDate: { [Op.gt]: new Date() },
    },
    order: [['endDate', 'DESC']],
  });

  if (!active) {
    return grantLocalSubscription({
      userId,
      plan: plan || 'premium',
      days,
      endDate,
      searchesLimit,
    });
  }

  const base = active.endDate > new Date() ? active.endDate : new Date();
  const nextEnd =
    endDate != null
      ? new Date(endDate)
      : new Date(base.getTime() + Number(days || 30) * 24 * 60 * 60 * 1000);

  const updates = { endDate: nextEnd };
  if (plan && VALID_PLANS.has(String(plan).toLowerCase())) {
    updates.plan = String(plan).toLowerCase();
    updates.searchesLimit =
      searchesLimit != null
        ? Number(searchesLimit)
        : getSearchesLimitForPlan(updates.plan);
  } else if (searchesLimit != null) {
    updates.searchesLimit = Number(searchesLimit);
  }

  await active.update(updates);
  return active;
};

export const countActiveSubscriptions = async () => {
  return Subscription.count({
    where: {
      status: 'active',
      endDate: { [Op.gt]: new Date() },
    },
  });
};
