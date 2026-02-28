const verifywebhook = (req, res, next) => {
    const secretHash = process.env.FLW_SECRET_HASH; // Ensure this matches .env
    const signature = req.headers['verif-hash'];

    if (!signature || signature !== secretHash) {
        return res.status(401).send('Unauthorized Webhook');
    }
    next();
}

module.exports = verifywebhook;