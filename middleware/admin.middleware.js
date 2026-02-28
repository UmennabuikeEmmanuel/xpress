require('dotenv').config();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-secret';

module.exports = function (req, res, next) {
    // Allow bypass in development if token is not set to a non-default value
    const header = req.headers['x-admin-token'] || req.query.admin_token || '';
    if (!ADMIN_TOKEN) return next();
    if (header && header === ADMIN_TOKEN) return next();

    res.status(401).json({ error: 'Unauthorized: missing or invalid admin token' });
};
