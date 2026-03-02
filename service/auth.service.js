const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { Op } = require('sequelize');
const crypto = require('crypto');

class AuthService {
    static async signup(data) {
        const { email, password, firstname, lastname } = data;
        
        const existing = await User.findOne({ where: { email } });
        if (existing) throw new Error("Email already exists");

        const hashedPassword = await bcrypt.hash(password, 10);
        let userData = {
            email,
            password: hashedPassword,
            firstname,
            lastname
        };

        // If a PIN is provided during signup, hash and store it
        if (data.pin) {
            userData.pin = await bcrypt.hash(data.pin, 10);
        }

        const user = await User.create(userData);

        return this.createSession(user);
    }

    static async login(email, password) {
        const user = await User.findOne({ where: { email } });
        if (!user) throw new Error("User not found");

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) throw new Error("Invalid password");

        return this.createSession(user);
    }

    static createSession(user) {
        const secret = process.env.JWT_SECRET || 'YOUR_SECRET_KEY';
        const token = jwt.sign({ id: user.id }, secret, { expiresIn: '24h' });
        return {
            token,
            userId: user.id,
            user: { id: user.id, firstname: user.firstname, lastname: user.lastname }
        };
    }

    // Set or update a user's PIN (stores hashed)
    static async setPin(userId, pin) {
        const user = await User.findByPk(userId);
        if (!user) throw new Error('User not found');
        const hashed = await bcrypt.hash(pin, 10);
        await user.update({ pin: hashed });
        return { success: true };
    }

    // Verify a user's PIN
    static async verifyPin(userId, pin) {
        const user = await User.findByPk(userId);
        if (!user || !user.pin) return false;
        const match = await bcrypt.compare(pin, user.pin);
        return match;
    }

    static async requestPasswordReset(email) {
        const user = await User.findOne({ where: { email } });
        if (!user) throw new Error("If an account exists, a reset link has been sent.");

        // Generate a random 6-digit token or string
        const resetToken = crypto.randomBytes(20).toString('hex');
        const expiry = Date.now() + 3600000; // 1 hour from now

        await user.update({ resetToken, resetTokenExpiry: expiry });

        // Simulate sending email
        console.log(`[ORION MAIL] To: ${email} | Link: https://xpress-eiuc.onrender.com//reset-password.html?token=${resetToken}`);
        
        return { message: "Check your console (simulated email)" };
    }

    static async finalizeReset(token, newPassword) {
        const user = await User.findOne({ 
            where: { resetToken: token, resetTokenExpiry: { [Op.gt]: Date.now() } } 
        });

        if (!user) throw new Error("Invalid or expired reset token.");

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await user.update({ 
            password: hashedPassword, 
            resetToken: null, 
            resetTokenExpiry: null 
        });

        return { message: "Password updated successfully." };
    }
}

module.exports = AuthService;
