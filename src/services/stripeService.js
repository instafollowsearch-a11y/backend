import Stripe from 'stripe';
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import {
  resolvePlanFromPriceId,
  getSearchesLimitForPlan,
  getStripePriceMap,
} from './stripePriceConfig.js';

dotenv.config();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PAID_STATUSES = new Set(['active', 'trialing']);

/**
 * @param {string} customerId - Stripe customer id
 * @param {string} priceId
 * @param {string} appUserId - App user UUID
 */
export const createCheckoutSession = async (customerId, priceId, appUserId) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/successfulpayment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/paymentfailed`,
      customer: customerId,
      client_reference_id: appUserId,
      metadata: {
        appUserId: String(appUserId),
        userId: String(appUserId),
      },
    });

    return session;
  } catch (error) {
    console.error('Error creating checkout session:', {
      message: error.message,
      type: error.type,
      code: error.code,
    });
    throw error;
  }
};

export const getSubscription = async (customer) => {
  try {
    if (!customer) {
      return {
        success: false,
        message: 'No active subscription found',
      };
    }

    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: 'all',
      limit: 20,
    });

    const subWithCoupon = subscriptions.data.find(
      (sub) => sub.discounts?.length > 0
    );

    const paidSubs = subscriptions.data.filter((sub) =>
      PAID_STATUSES.has(sub.status)
    );

    if (paidSubs.length === 0) {
      return {
        success: false,
        message: 'No active subscription found',
      };
    }

    const activeSub = paidSubs[0];
    const productId = activeSub.items.data[0].price.product;
    const activeProduct = await stripe.products.retrieve(productId);

    return {
      success: true,
      data: {
        id: activeSub.id,
        status: activeSub.status,
        active: PAID_STATUSES.has(activeSub.status),
        name: activeProduct.name,
        productId: activeProduct.id,
        priceId: activeSub.items.data[0].price.id,
        current_period_end: activeSub.current_period_end,
        current_period_start: activeSub.current_period_start,
        cancel_at_period_end: activeSub.cancel_at_period_end,
        discountUsed: Boolean(subWithCoupon),
        plan: activeProduct.name,
      },
    };
  } catch (error) {
    console.error('Error retrieving subscription:', {
      message: error.message,
      type: error.type,
      code: error.code,
    });
    throw error;
  }
};

export const createCustomer = async (email, name, userId = null) => {
  try {
    return await stripe.customers.create({
      email,
      name,
      metadata: { userId: userId ? String(userId) : '' },
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
};

/**
 * Upsert local subscription row from a Stripe subscription object.
 */
export const upsertSubscriptionFromStripe = async ({
  userId,
  stripeSubscription,
  priceId: priceIdOverride = null,
}) => {
  if (!userId || !stripeSubscription) return null;

  const priceId =
    priceIdOverride ||
    stripeSubscription.items?.data?.[0]?.price?.id ||
    null;

  const resolved = resolvePlanFromPriceId(priceId);
  const plan = resolved.ok ? resolved.plan : 'basic';
  const searchesLimit = getSearchesLimitForPlan(plan);

  const stripeStatus = stripeSubscription.status;
  let status = 'active';
  if (stripeStatus === 'canceled' || stripeStatus === 'unpaid') {
    status = 'cancelled';
  } else if (
    stripeStatus === 'incomplete_expired' ||
    stripeStatus === 'incomplete'
  ) {
    status = 'expired';
  } else if (!PAID_STATUSES.has(stripeStatus)) {
    status = 'expired';
  }

  const startDate = stripeSubscription.current_period_start
    ? new Date(stripeSubscription.current_period_start * 1000)
    : new Date();
  const endDate = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const stripeSubscriptionId = stripeSubscription.id;
  const stripeCustomerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id;

  let row = await Subscription.findOne({
    where: {
      [Op.or]: [
        { stripeSubscriptionId },
        { userId, status: 'active' },
      ],
    },
    order: [['updatedAt', 'DESC']],
  });

  const payload = {
    userId,
    plan,
    status,
    startDate,
    endDate,
    searchesLimit,
    stripeSubscriptionId,
    stripeCustomerId: stripeCustomerId || null,
  };

  if (row) {
    await row.update(payload);
    return row;
  }

  row = await Subscription.create({
    ...payload,
    searchesUsed: 0,
  });
  return row;
};

export const findUserIdForStripeCustomer = async (stripeCustomerId) => {
  if (!stripeCustomerId) return null;
  const user = await User.findOne({
    where: { stripeCustomerId },
  });
  return user?.id || null;
};

export const verifyPaymentBySessionId = async (sessionId, user = null) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (!session) {
      return {
        success: false,
        message: 'Session not found',
        paymentVerified: false,
      };
    }

    if (user) {
      const appUserId =
        session.metadata?.appUserId ||
        session.metadata?.userId ||
        session.client_reference_id;
      const customerMatch =
        user.stripeCustomerId &&
        session.customer &&
        String(session.customer) === String(user.stripeCustomerId);
      const userMatch =
        appUserId && String(appUserId) === String(user.id);

      if (!customerMatch && !userMatch) {
        return {
          success: false,
          message: 'Session does not belong to this user',
          paymentVerified: false,
        };
      }
    }

    const paymentStatus = session.payment_status;
    const isPaid = paymentStatus === 'paid';

    let subscriptionRow = null;
    if (isPaid) {
      let stripeSub = session.subscription;
      if (typeof stripeSub === 'string') {
        stripeSub = await stripe.subscriptions.retrieve(stripeSub);
      }

      const userId =
        user?.id ||
        session.metadata?.appUserId ||
        session.metadata?.userId ||
        session.client_reference_id ||
        (await findUserIdForStripeCustomer(session.customer));

      if (userId && stripeSub) {
        subscriptionRow = await upsertSubscriptionFromStripe({
          userId,
          stripeSubscription: stripeSub,
        });
      }
    }

    return {
      success: isPaid,
      message: isPaid ? 'Payment verified successfully' : 'Payment not completed',
      paymentVerified: isPaid,
      subscription: subscriptionRow
        ? {
            plan: subscriptionRow.plan,
            status: subscriptionRow.status,
            searchesLimit: subscriptionRow.searchesLimit,
            endDate: subscriptionRow.endDate,
          }
        : null,
    };
  } catch (error) {
    console.error('Error verifying payment by session:', error);
    return {
      success: false,
      message: 'Error verifying payment',
      error: error.message,
      paymentVerified: false,
    };
  }
};

export const cancelSubscription = async (customer) => {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: 'active',
    });
    const trialing = await stripe.subscriptions.list({
      customer,
      status: 'trialing',
    });
    const all = [...subscriptions.data, ...trialing.data];
    if (all.length === 0) {
      return {
        success: false,
        message: 'No active subscription found',
      };
    }
    const subscription = all[0];
    await stripe.subscriptions.cancel(subscription.id);

    const userId = await findUserIdForStripeCustomer(customer);
    if (userId) {
      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscription: { ...subscription, status: 'canceled' },
      });
    }

    return {
      success: true,
      message: 'Subscription canceled successfully',
    };
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return {
      success: false,
      message: 'Error canceling subscription',
      error: error.message,
    };
  }
};

export const changeSubscription = async (customer, newPriceId) => {
  try {
    const resolved = resolvePlanFromPriceId(newPriceId);
    if (!resolved.ok) {
      return {
        success: false,
        message: resolved.error,
      };
    }

    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: 'active',
    });
    const trialing = await stripe.subscriptions.list({
      customer,
      status: 'trialing',
    });
    const paid = [...subscriptions.data, ...trialing.data];
    if (paid.length === 0) {
      return {
        success: false,
        message: 'No active subscription found',
      };
    }
    const subscription = paid[0];
    const subscriptionItemId = subscription.items.data[0].id;

    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId,
        },
      ],
      proration_behavior: 'always_invoice',
      billing_cycle_anchor: 'now',
    });

    const userId = await findUserIdForStripeCustomer(customer);
    if (userId) {
      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscription: updated,
        priceId: newPriceId,
      });
    }

    return {
      success: true,
      message: 'Subscription updated successfully',
    };
  } catch (error) {
    console.error('Error updating subscription:', {
      message: error.message,
      type: error.type,
      code: error.code,
    });
    return {
      success: false,
      message: 'Error updating subscription',
      error: error.message,
    };
  }
};

export const applyDiscount = async (customer) => {
  try {
    const couponId = process.env.STRIPE_COUPON_ID || 'DD3Mdjdl';
    const allsubscriptions = await stripe.subscriptions.list({
      customer,
      status: 'all',
    });
    const subWithCoupon = allsubscriptions.data.find(
      (sub) => sub.discounts?.length > 0
    );
    if (subWithCoupon) {
      return {
        success: false,
        message: 'Coupon already applied',
      };
    }

    const subscriptions = allsubscriptions.data.filter((sub) =>
      PAID_STATUSES.has(sub.status)
    );
    if (subscriptions.length === 0) {
      return {
        success: false,
        message: 'No active subscription found',
      };
    }
    const subscription = subscriptions[0];
    await stripe.subscriptions.update(subscription.id, {
      discounts: [{ coupon: couponId }],
    });

    return {
      success: true,
      message: 'Coupon applied successfully',
    };
  } catch (error) {
    console.error('Error updating subscription:', error);
    return {
      success: false,
      message: 'Error updating subscription',
      error: error.message,
    };
  }
};

/**
 * Handle Stripe webhook events (signature already verified).
 */
export const handleStripeWebhookEvent = async (event) => {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break;
      const userId =
        session.metadata?.appUserId ||
        session.metadata?.userId ||
        session.client_reference_id ||
        (await findUserIdForStripeCustomer(session.customer));
      if (!userId || !session.subscription) break;
      const stripeSub = await stripe.subscriptions.retrieve(
        session.subscription
      );
      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscription: stripeSub,
      });
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object;
      const userId = await findUserIdForStripeCustomer(stripeSub.customer);
      if (!userId) break;
      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscription: stripeSub,
      });
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object;
      if (!invoice.subscription || !invoice.customer) break;
      const userId = await findUserIdForStripeCustomer(invoice.customer);
      if (!userId) break;
      const stripeSub = await stripe.subscriptions.retrieve(invoice.subscription);
      await upsertSubscriptionFromStripe({
        userId,
        stripeSubscription: stripeSub,
      });
      break;
    }
    default:
      break;
  }
};

export { stripe, getStripePriceMap };
export default stripe;
