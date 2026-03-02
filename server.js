const express = require('express');
const { join } = require('path');
// const cors = require('cors');
const { sequelize } = require('./models'); // Import DB
const verifywebhook = require('./middleware/wallet.middleware');
const adminAuth = require('./middleware/admin.middleware');
const controller = require('./controller/wallet.controller');
// const AuthService = require('./service/auth.service');
const auth = require('./controller/user.controller');


require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(__dirname + "dashboard"));
// app.use(cors());
// Simple CORS middleware (allows all origins for development)
// app.use((req, res, next) => {
//     res.header('Access-Control-Allow-Origin', '*');
//     res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
//     if (req.method === 'OPTIONS') {
//         res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
//         return res.sendStatus(200);
//     }
//     next();
// });


// Routes
app.post('/api/accounts/create', controller.createVA);
app.post('/api/accounts/resolve', controller.verifyAccount); // New Route
app.post('/api/withdraw', controller.withdraw);
app.post('/api/webhooks', verifywebhook, controller.webhooks);
app.post('/api/purchase', controller.purchaseAsset);
// protect escrow actions
app.post('/api/escrow/release', adminAuth, controller.releaseEscrow);
app.post('/api/escrow/cancel', adminAuth, controller.cancelEscrow);
// Admin routes (protected)
app.get('/api/admin/users', adminAuth, controller.getAllUsers);
app.get('/api/admin/transactions', adminAuth, controller.getAllTransactions);
app.get('/api/admin/escrows', adminAuth, controller.getEscrows);

// Serve dashboard static files (so admin UI is available at /dashboard/admin)
app.get('/api/balance/:userId', controller.getBalance);
app.post('/api/verify-payment', controller.verifyPayment);
app.get('/api/transactions/:userId', controller.getTransactionHistory);
app.get('/api/find-transaction', controller.findTransaction);// ...existing code...
app.get('/api/banks', controller.getBanks);
app.post('/api/auth/signup', auth.signup);
app.post('/api/auth/login', auth.login);
app.get('/api/auth', auth.authPage);
app.post('/api/auth/set-pin', auth.setPin);
app.post('/api/auth/validate-pin', auth.validatePin);
app.get('/dash', (req, res) => {
    res.sendFile(join(__dirname, '/dashboard/users/dashboard.html'));
});

app.get('/dashboard/admin', (req, res) => {
    // res.sendFile();
    console.log(join(__dirname, '/dashboard/admin/admin.html'));
});


// Sync DB and Start Server
sequelize.sync({ alter: true }).then(() => {
    console.log("Database connected & synced");
    app.listen(8000, () => {
        console.log('Fintech Module is running on port 8000');
    });
}).catch(err => console.log("DB Error:", err));
