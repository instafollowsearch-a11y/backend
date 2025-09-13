import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createCustomer, createCheckoutSession, verifyPaymentBySessionId, getSubscription, cancelSubscription, changeSubscription, applyDiscount } from '../services/stripeService.js'

dotenv.config();

export const createPaymentSession = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!req.body) {
            return res.status(400).json({ error: 'Request body is missing' });
        }

        const { priceId } = req.body;

        if (!priceId) {
            return res.status(400).json({ error: 'Price Id is required' });
        }

        let stripeCustomerId = user?.stripeCustomerId;
        if (!stripeCustomerId) {
            const customer = await createCustomer(user?.email, user?.username);
            stripeCustomerId = customer.id;

            await user.update({ stripeCustomerId });
        }

        const existing = await getSubscription(user.stripeCustomerId);

        if (existing?.success) {
            return res.status(400).json({ error: 'User already has a subscription' });
        }

        const session = await createCheckoutSession(user.stripeCustomerId, priceId);

        res.json({
            success: true,
            sessionId: session.id,
            url: session.url
        });
    } catch (error) {
        console.error('Error creating payment session:', error);
        res.status(500).json({ error: error.message });
    }
};

export const getUserSubscription = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let stripeCustomerId = user?.stripeCustomerId;
        if (!stripeCustomerId) {
            res.status(404).json({ error: 'User not found' });
        }

        const subscription = await getSubscription(user.stripeCustomerId);

        res.json({
            success: subscription?.success,
            subscription: subscription?.data
        });
    } catch (error) {
        console.error('Error creating payment session:', error);
        res.status(500).json({ error: error.message });
    }
};

export const verifyPaymentBySession = async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }
        const result = await verifyPaymentBySessionId(sessionId);

        res.json(result);
    } catch (error) {
        console.error('Error verifying payment by session:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
};

export const cancelUserSubscription = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let stripeCustomerId = user?.stripeCustomerId;
        if (!stripeCustomerId) {
            res.status(404).json({ error: 'User not found' });
        }

        const subscription = await cancelSubscription(user.stripeCustomerId);

        res.json({ success: subscription?.success, message: subscription?.message });
    } catch (error) {
        console.error('Error canceling subscription:', error);
        res.status(500).json({ error: error.message });
    }
};

export const changeUserSubscription = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let stripeCustomerId = user?.stripeCustomerId;
        if (!stripeCustomerId) {
            res.status(404).json({ error: 'User not found' });
        }

        const { newPriceId } = req.body;

        if (!newPriceId) {
            return res.status(400).json({
                success: false,
                error: 'New price ID is required'
            });
        }

        const subscription = await changeSubscription(user.stripeCustomerId, newPriceId);

        res.json({ success: subscription?.success, message: subscription?.message });
    } catch (error) {
        console.error('Error canceling subscription:', error);
        res.status(500).json({ error: error.message });
    }
};

export const applyDiscountToSubscription = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let stripeCustomerId = user?.stripeCustomerId;
        if (!stripeCustomerId) {
            res.status(404).json({ error: 'User not found' });
        }


        const subscription = await applyDiscount(user.stripeCustomerId);

        res.json({ success: subscription?.success, message: subscription?.message });
    } catch (error) {
        console.error('Error applying discount to subscription:', error);
        res.status(500).json({ error: error.message });
    }
};