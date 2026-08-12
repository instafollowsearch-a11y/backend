import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { assertUserHasPaidAccess } from '../services/entitlementService.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'No user found with this id'
        });
      }

      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }
  } catch (error) {
    next(error);
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

/**
 * Must run after protect. Allows admin, active DB sub, or active/trialing Stripe.
 */
export const requireActiveSubscription = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route',
      });
    }

    if (req.paidAccessChecked === true) {
      return next();
    }

    const hasAccess = await assertUserHasPaidAccess(req.user);
    req.paidAccessChecked = true;
    req.hasPaidAccess = hasAccess;

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Active subscription required',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);
        req.user = user;
      } catch (error) {
        // Token is invalid, but continue without user
        req.user = null;
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
};