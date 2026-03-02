// controller/wallet.controller.js
const wallet = require('../service/wallet.service');
const client = require('../config/client.config');
const { User, Transaction, sequelize } = require('../models'); // Added for webhook logic

// 1. Verify Account Number (The missing function!)
exports.verifyAccount = async (req, res) => {
    try {
        const { account_number, account_bank } = req.body;
        const result = await wallet.resolveAccount(account_number, account_bank);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.refundUser = async (req, res) => {
    try {
        const { reference } = req.body; // Pass the transaction reference (tx_ref)
        const result = await wallet.refundTransaction(reference);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// 2. Verify Payment (Manual Check)
exports.verifyPayment = async (req, res) => {
    try {
        const { transactionId } = req.body;
        const result = await wallet.verifyAndCredit(transactionId);
        res.status(200).json(result);
    } catch (error) {
        console.error("FULL ERROR LOG:", error);
        const message = error.response?.data?.message || error.message || "An unknown error occurred";
        res.status(400).json({ error: message });
    }
};

// 3. Withdraw (Transfer)
// 3. Withdraw (Transfer) - REFINED
exports.withdraw = async (req, res) => {
    try {
        const userId = req.body.userId || 1;
        const { amount, bankCode, accountNumber } = req.body;

        // INPUT VALIDATION
        if (!userId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) {
            return res.status(400).json({ error: 'Invalid userId' });
        }
        if (!amount || !Number.isFinite(amount) || amount < 100 || amount > 5000000) {
            return res.status(400).json({ error: 'Invalid amount (must be 100-5,000,000)' });
        }
        if (!bankCode || typeof bankCode !== 'string' || bankCode.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid bank code' });
        }
        if (!accountNumber || !/^\d{10,}$/.test(accountNumber.toString())) {
            return res.status(400).json({ error: 'Invalid account number (must be 10+ digits)' });
        }

        // STEP 1: Deduct from DB & Lock balance (Uses the new Service logic)
        const localTx = await wallet.initiateTransfer(userId, amount, bankCode, accountNumber);

        // STEP 2: Call Flutterwave API
        try {
            const transfer = await client.post('/transfers', {
                account_bank: bankCode,
                account_number: accountNumber,
                amount: amount,
                currency: "NGN",
                reference: localTx.tx_ref, // Link our DB ID to FLW
                callback_url: "https://xpress-eiuc.onrender.com/webhooks"
            });

            res.status(200).json(transfer.data);
        } catch (flwError) {
            // STEP 3: If FLW fails immediately, refund the DB record
            console.error("FLW API ERROR:", flwError.response?.data || flwError.message);
            await wallet.refundTransaction(localTx.tx_ref);

            res.status(400).json({
                error: "Transfer failed at bank",
                details: flwError.response?.data?.message
            });
        }

    } catch (error) {
        // This catches "Insufficient Funds" from initiateWithdrawal
        res.status(400).json({ error: error.message });
    }
};

// 4. Create Virtual Account
exports.createVA = async (req, res) => {
    try {
        const { email, bvn, firstname, lastname } = req.body;
        const account = await wallet.createVA(email, bvn, firstname, lastname);
        res.status(201).json(account);
    } catch (error) {
        res.status(400).json({ error: error.response?.data || "Internal Server Error" });
    }
};


// controller/wallet.controller.js

// ... existing exports ...

// 9. Get List of Banks (Dynamic)
exports.getBanks = async (req, res) => {
    try {
        // Fetch banks for Nigeria (NG)
        const response = await client.get('/banks/NG');

        // Sort them alphabetically by name for easier reading
        const sortedBanks = response.data.data.sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        res.status(200).json({
            status: "success",
            message: "Banks fetched successfully",
            data: sortedBanks
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// controller/wallet.controller.js
exports.findTransaction = async (req, res) => {
    try {
        const response = await client.get('/transactions', {
            params: {
                from: '2026-01-01', // Look from the beginning of the year
                to: '2026-12-31'
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}


// 6. Get Balance
exports.getBalance = async (req, res) => {
    try {
        const { userId } = req.params;
        const balanceData = await wallet.getBalance(userId);
        res.status(200).json(balanceData);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
};

// Purchase Asset (Reserve funds -> escrow)
exports.purchaseAsset = async (req, res) => {
    try {
        const { userId, amount, assetId, assetShare } = req.body;
        
        // INPUT VALIDATION
        if (!userId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) {
            return res.status(400).json({ error: 'Invalid userId' });
        }
        if (!amount || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
            return res.status(400).json({ error: 'Invalid amount (must be 1-10,000,000)' });
        }
        if (!assetId || !Number.isInteger(Number(assetId)) || Number(assetId) <= 0) {
            return res.status(400).json({ error: 'Invalid assetId' });
        }
        if (!assetShare || assetShare < 1 || assetShare > 100) {
            return res.status(400).json({ error: 'Invalid assetShare (must be 1-100)' });
        }
        
        const tx = await wallet.purchaseAsset(userId, amount, assetId, assetShare);
        res.status(201).json({ status: 'success', data: tx });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Release an escrow (admin or post-conditions)
exports.releaseEscrow = async (req, res) => {
    try {
        const { tx_ref } = req.body;
        const tx = await wallet.releaseEscrow(tx_ref);
        res.status(200).json({ status: 'success', data: tx });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Cancel an escrow and refund the user
exports.cancelEscrow = async (req, res) => {
    try {
        const { tx_ref } = req.body;
        const result = await wallet.cancelEscrow(tx_ref);
        res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// 7. Transaction History
exports.getTransactionHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        // Fixed: changed WalletService to wallet to match your import
        const history = await wallet.getTransactionHistory(userId);
        res.status(200).json({ status: "success", data: history });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// --- ADMIN: List all users
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.findAll({ order: [['id', 'ASC']] });
        res.status(200).json({ status: 'success', data: users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- ADMIN: List all transactions
exports.getAllTransactions = async (req, res) => {
    try {
        const txs = await Transaction.findAll({ order: [['createdAt', 'DESC']] });
        res.status(200).json({ status: 'success', data: txs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- ADMIN: List escrow transactions
exports.getEscrows = async (req, res) => {
    try {
        const escrows = await Transaction.findAll({ where: { is_escrow: true }, order: [['createdAt', 'DESC']] });
        res.status(200).json({ status: 'success', data: escrows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 8. Webhooks
exports.webhooks = async (req, res) => {
    const data = req.body;

    // 1. Handle Deposits
    if (data.event === 'charge.completed' && data.data.status === 'successful') {
        try {
            const verification = await wallet.verifyTransaction(data.data.id);
            // controller/wallet.controller.js (Inside webhooks function)

            if (verification.status === 'success' && Number(verification.data.amount) >= Number(data.data.amount)) {

                const flwTxId = String(data.data.id);  // Convert to string
                const txRef = data.data.tx_ref || data.data.reference || '';
                const cleanEmail = (data.data.customer?.email || '').toLowerCase().trim();
                const amount = data.data.amount;

                console.log(`Processing Credit for: ${cleanEmail} (flw_tx_id: ${flwTxId}, tx_ref: ${txRef}, amount: ${amount})`);

                // creditWallet now handles duplicate detection AND user lookup
                // Uses Flutterwave's transaction ID (not tx_ref) for uniqueness
                const success = await wallet.creditWallet(
                    cleanEmail,
                    amount,
                    flwTxId,
                    txRef
                );

                if (success === true) {
                    console.log('Wallet Credited via Webhook (DB Updated)');
                } else if (success === 'duplicate') {
                    console.log(`[DUPLICATE IGNORED] Transaction ${txRef} already processed.`);
                } else if (success === 'user_not_found') {
                    console.error(`[USER NOT FOUND] Webhook received for ${cleanEmail} but no matching user in DB.`);
                } else {
                    console.error('Webhook Logic Ran, but Wallet WAS NOT credited (unexpected)');
                }
            }
        } catch (err) {
            console.error('Deposit Webhook Error:', err.message);
        }
    }

    // 2. Handle Withdrawals (Transfers)
    if (data.event === 'transfer.completed') {
        const { reference, status } = data.data;
        const internalStatus = status.toLowerCase() === 'successful' ? 'successful' : 'failed';

        if (internalStatus === 'failed') {
            console.log(`Transfer ${reference} failed. Initiating Refund...`);
            try {
                // Use ONLY the service. It handles finding the user and incrementing the balance.
                await wallet.refundTransaction(reference);
                console.log(`Refund successful for ${reference}`);
            } catch (err) {
                console.error(`Refund failed for ${reference}:`, err.message);
            }
        } else {
            // Update status to successful if it didn't fail
            await wallet.updateTransactionStatus(reference, 'successful');
            console.log(`Transfer ${reference} successful`);
        }
    }

    res.status(200).send('Webhook Received');
}; 
