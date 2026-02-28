const AuthService = require('../service/auth.service');
const { join } = require('path');

exports.signup = async (req, res) => {
    try {
        const { email, password, fullname } = req.body;

        // Add this check to stop the crash!
        if (!fullname || typeof fullname !== 'string') {
            return res.status(400).json({ error: "Full Name is required and must be a string." });
        }

        const nameParts = fullname.trim().split(' ');
        const firstname = nameParts[0];
        const lastname = nameParts.slice(1).join(' ') || ''; 

        const result = await AuthService.signup({ email, password, firstname, lastname });
        res.status(201).json(result);
    } catch (err) {
        console.error("Signup error details:", err);
        res.status(400).json({ error: err.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await AuthService.login(email, password);
        res.json(result);
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
}

exports.authPage = async (req, res) => {
    res.sendFile(join(__dirname, '../dashboard/users/auth.html'));
}

exports.setPin = async (req, res) => {
    try {
        const { userId, pin } = req.body;
        if (!userId || !pin) return res.status(400).json({ error: 'userId and pin required' });
        await AuthService.setPin(userId, pin);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.validatePin = async (req, res) => {
    try {
        const { userId, pin } = req.body;
        if (!userId || !pin) return res.status(400).json({ error: 'userId and pin required' });
        const ok = await AuthService.verifyPin(userId, pin);
        if (ok) return res.json({ success: true });
        return res.status(401).json({ error: 'Invalid PIN' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};