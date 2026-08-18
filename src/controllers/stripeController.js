import {
  createCustomer,
  createCheckoutSession,
  verifyPaymentBySessionId,
  getSubscription,
  cancelSubscription,
  changeSubscription,
  applyDiscount,
  handleStripeWebhookEvent,
  stripe,
} from '../services/stripeService.js';
import { resolvePlanFromPriceId } from '../services/stripePriceConfig.js';
import { resolveUserEntitlement } from '../services/entitlementService.js';
import { emitReqAnalyticsEvent } from '../services/productAnalyticsService.js';

export const createPaymentSession = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No token provided' });
    }

    if (!req.body) {
      return res.status(400).json({ error: 'Request body is missing' });
    }

    const { priceId } = req.body;
    const resolved = resolvePlanFromPriceId(priceId);
    if (!resolved.ok) {
      return res.status(400).json({ error: resolved.error });
    }

    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await createCustomer(user.email, user.username, user.id);
      stripeCustomerId = customer.id;
      await user.update({ stripeCustomerId });
    }

    const existing = await getSubscription(stripeCustomerId);
    if (existing?.success) {
      return res.status(400).json({ error: 'User already has a subscription' });
    }

    const session = await createCheckoutSession(
      stripeCustomerId,
      priceId,
      user.id
    );

    void emitReqAnalyticsEvent(req, {
      event: 'checkout_started',
      path: '/pricing',
      site: 'main',
      userId: user.id,
      props: { priceId, plan: resolved.plan },
    });

    return res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Error creating payment session:', {
      message: error.message,
      type: error.type,
      code: error.code,
    });
    return res.status(500).json({ error: error.message });
  }
};

export const getUserSubscription = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const entitlement = await resolveUserEntitlement(user);
    return res.json({
      success: true,
      source: entitlement.source,
      subscription: entitlement.subscription,
    });
  } catch (error) {
    console.error('Error getting subscription:', error);
    return res.status(500).json({ error: error.message });
  }
};

/** Alias of merged entitlement (DB then Stripe). */
export const getUserEntitlement = getUserSubscription;

export const verifyPaymentBySession = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required',
        paymentVerified: false,
      });
    }

    const result = await verifyPaymentBySessionId(sessionId, user);
    return res.json(result);
  } catch (error) {
    console.error('Error verifying payment by session:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      paymentVerified: false,
    });
  }
};

export const cancelUserSubscription = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer for this user' });
    }

    const subscription = await cancelSubscription(stripeCustomerId);
    return res.json({
      success: subscription?.success,
      message: subscription?.message,
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const changeUserSubscription = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer for this user' });
    }

    const { newPriceId } = req.body;
    const resolved = resolvePlanFromPriceId(newPriceId);
    if (!resolved.ok) {
      return res.status(400).json({
        success: false,
        error: resolved.error,
      });
    }

    const subscription = await changeSubscription(
      stripeCustomerId,
      newPriceId
    );
    return res.json({
      success: subscription?.success,
      message: subscription?.message,
    });
  } catch (error) {
    console.error('Error changing subscription:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const applyDiscountToSubscription = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer for this user' });
    }

    const subscription = await applyDiscount(stripeCustomerId);
    return res.json({
      success: subscription?.success,
      message: subscription?.message,
    });
  } catch (error) {
    console.error('Error applying discount to subscription:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleStripeWebhookEvent(event);
    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};
