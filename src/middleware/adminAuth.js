import jwt from 'jsonwebtoken';

export const adminAuth = async (req, res, next) => {
  try {
    const { admin_login, admin_password } = req.body;
    
    // Check login and password from environment variables
    if (admin_login !== process.env.ADMIN_LOGIN || admin_password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Create JWT token for admin
    const token = jwt.sign(
      { 
        role: 'admin',
        login: admin_login 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    req.adminToken = token;
    next();
  } catch (error) {
    console.error('Admin authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication'
    });
  }
};

export const verifyAdminToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Admin token not provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required'
      });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    console.error('Admin token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid admin token'
    });
  }
}; 