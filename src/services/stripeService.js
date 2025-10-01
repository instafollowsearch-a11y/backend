import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createCheckoutSession = async (userId, priceId) => {
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
      customer: userId,
      client_reference_id: userId,
      metadata: {
        userId: userId
      },
    });

    return session;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
};

export const getSubscription = async (customer) => {
  try {
    const subscriptions = await stripe.subscriptions.list({ customer, status: "all" });
    const subWithCoupon = subscriptions.data.find(
      (sub) => sub.discounts?.length > 0
    );

    const activeSubs = subscriptions?.data?.filter((sub) => sub.status === "active");
    if (activeSubs?.length === 0) {
      return {
        success: false,
        message: 'No active subscription found'
      }
    }
    const activeProduct = await stripe.products.retrieve(activeSubs[0].items.data[0].price.product);
    return {
      success: activeProduct ? true : false,
      data: { ...activeProduct, ...activeSubs[0], discountUsed: subWithCoupon ? true : false }
    }
  } catch (error) {
    console.error('Error retrieving subscription:', error);
    throw error;
  }
};

export const createCustomer = async (email, name, userId = null) => {
  try {
    return await stripe.customers.create({ email, name, metadata: { userId } });
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
};

export const verifyPaymentBySessionId = async (sessionId) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return {
        success: false,
        message: 'Session not found',
        paymentVerified: false
      };
    }

    const paymentStatus = session.payment_status;
    const isPaid = paymentStatus === 'paid';

    return {
      success: true,
      message: isPaid ? 'Payment verified successfully' : 'Payment not completed',
      paymentVerified: isPaid
    };
  } catch (error) {
    console.error('Error verifying payment by session:', error);
    return {
      success: false,
      message: 'Error verifying payment',
      error: error.message,
      paymentVerified: false
    };
  }
};

export const cancelSubscription = async (customer) => {
  try {
    const subscriptions = await stripe.subscriptions.list({ customer, status: "active" });
    if (subscriptions?.data?.length === 0) {
      return {
        success: false,
        message: 'No active subscription found'
      }
    }
    const subscription = subscriptions?.data[0];
    await stripe.subscriptions.cancel(subscription.id);

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
    const subscriptions = await stripe.subscriptions.list({ customer, status: "active" });
    if (subscriptions?.data?.length === 0) {
      return {
        success: false,
        message: 'No active subscription found'
      }
    }
    const subscription = subscriptions.data[0];

    const subscriptionItemId = subscription.items.data[0].id;

    await stripe.subscriptions.update(subscription.id, {
      items: [
        {
          id: subscriptionItemId, // ✅ Correct item ID
          price: newPriceId,
        },
      ],
      proration_behavior: "always_invoice",
      billing_cycle_anchor: 'now',
    });

    return {
      success: true,
      message: 'Subscription updated successfully',
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

export const applyDiscount = async (customer) => {
  try {
    const allsubscriptions = await stripe.subscriptions.list({ customer, status: "all" });
    const subWithCoupon = allsubscriptions.data.find(
      (sub) => sub.discounts?.length > 0
    );
    if (subWithCoupon) {
      return {
        success: false,
        message: 'Coupon already applied'
      }
    }

    const subscriptions = allsubscriptions?.data?.filter((sub) => sub.status === "active");
    if (subscriptions?.data?.length === 0) {
      return {
        success: false,
        message: 'No active subscription found'
      }
    }
    const subscription = subscriptions?.[0];
    await stripe.subscriptions.update(subscription.id, { discounts: [{ coupon: "DD3Mdjdl" }] });

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

export default stripe; 