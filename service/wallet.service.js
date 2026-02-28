const client = require('../config/client.config'); // Ensure this file exists as shown below
const { User, Transaction, sequelize } = require('../models');
const { Op } = require('sequelize');

class WalletService {
    
    // 1. Create Virtual Account (Deposit Method)
    static async createVA(email, bvn, firstname, lastname) {
        // Check if user already exists
        let user = await User.findOne({ where: { email } });
        if (!user) {
            user = await User.create({ email, firstname, lastname });
        }

        try {
            const response = await client.post('/virtual-account-numbers', {
                email,
                is_permanent: true,
                bvn,
                firstname,
                lastname,
                narration: `${firstname} ${lastname}`
            });

            // Update User with new VA details
            await user.update({
                account_number: response.data.data.account_number,
                bank_name: response.data.data.bank_name
            });

            return response.data;
        } catch (error) {
            throw error;
        }
    }

    // service/wallet.service.js

static async getBalance(userId) {
    try {
        const user = await User.findByPk(userId);
        if (!user) {
            throw new Error("User not found");
        }
        return {
            email: user.email,
            balance: user.wallet_balance,
            currency: "NGN"
        };
    } catch (error) {
        throw error;
    }
}

    // service/wallet.service.js

static async updateTransactionStatus(tx_ref, status) {
    try {
        const transaction = await Transaction.findOne({ where: { tx_ref } });
        if (transaction) {
            await transaction.update({ status });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error updating transaction:", error);
        throw error;
    }
}

    // 2. Resolve Account (NEW FEATURE: Verify before transfer)
    static async resolveAccount(account_number, account_bank) {
        try {
            const response = await client.post('/accounts/resolve', {
                account_number,
                account_bank
            });
            return response.data;
        } catch (error) {
            throw error;
        }
    }

    // 3. Initiate Transfer (Withdrawal)
    // service/wallet.service.js

static async initiateTransfer(userId, amount, account_bank, account_number) {
    // 1. Start a database transaction
    const t = await sequelize.transaction();

    try {
        // 2. LOCK the user row so no other request can touch this balance
        const user = await User.findByPk(userId, { 
            transaction: t,
            lock: t.LOCK.UPDATE 
        });

        if (!user) throw new Error("User not found");

        // 3. Check Balance (Securely while locked)
        if (parseFloat(user.wallet_balance) < amount) {
            throw new Error("Insufficient Funds");
        }

        // 4. Deduct the money from the wallet immediately
        await user.decrement('wallet_balance', { by: amount, transaction: t });

        const tx_ref = `WTH-${userId}-${Date.now()}`;

        // 5. Create the Pending Transaction Record
        await Transaction.create({
            UserId: user.id,
            tx_ref,
            amount,
            type: 'withdrawal',
            status: 'pending',
            narration: 'Withdrawal initiated'
        }, { transaction: t });

        // 6. NOW call Flutterwave (While the DB transaction is still open)
        try {
            const response = await client.post('/transfers', {
                account_bank,
                account_number,
                amount,
                currency: "NGN",
                narration: "Withdrawal from wallet",
                reference: tx_ref,
                callback_url: "https://pseudopodal-jaleesa-guardedly.ngrok-free.dev/api/webhooks" 
            });

            // 7. If API succeeds, COMMIT the database changes
            await t.commit();
            return response.data;

        } catch (apiError) {
            // 8. If API fails, ROLLBACK the database (User gets their money back instantly)
            console.error("Flutterwave API Error:", apiError.response?.data || apiError.message);
            await t.rollback();
            throw new Error(apiError.response?.data?.message || "Transfer failed at bank gateway");
        }

    } catch (error) {
        // 9. Rollback if anything else goes wrong (User not found, Insufficient funds, etc)
        if (!t.finished) await t.rollback();
        throw error;
    }
}

// service/wallet.service.js

static async getTransactionHistory(userId) {
    try {
        const transactions = await Transaction.findAll({
            where: { UserId: userId },
            order: [['createdAt', 'DESC']] // Shows newest transactions first
        });
        return transactions;
    } catch (error) {
        throw error;
    }
}

static async verifyTransaction(transactionId) {
    try {
        const response = await client.get(`/transactions/${transactionId}/verify`);
        return response.data;
    } catch (error) {
        throw error;
    }
}

// service/wallet.service.js

static async verifyAndCredit(transactionId) {
    try {
        // Change 'this' to 'WalletService' or just 'this' IF verifyTransaction is static
        const response = await WalletService.verifyTransaction(transactionId); 
        const data = response.data;

        if (data.status === "successful") {
            const credited = await WalletService.creditWallet(
                data.customer.email, 
                data.amount, 
                data.tx_ref
            );
            
            if (credited) {
                return { status: "success", message: "Wallet credited successfully", amount: data.amount };
            }
            return { status: "already_done", message: "Transaction already processed" };
        }
        return { status: "failed", message: "Transaction not successful on Flutterwave" };
    } catch (error) {
        throw error;
    }
}

// service/wallet.service.js

static async creditWallet(email, amount, flwTxId, txRef) {
    // 1. Normalize Email (Fixes the Case Sensitivity Bug)
    const cleanEmail = email.toLowerCase().trim();

    // Use a DB transaction to handle race conditions
    const t = await sequelize.transaction();

    try {
        // 2. Find User (case-insensitive match) WITH ROW LOCK to prevent race conditions
        console.log(`[DEBUG] Searching for user with email: ${cleanEmail}`);
        
        const user = await User.findOne({
            where: sequelize.where(
                sequelize.fn('lower', sequelize.col('email')),
                Op.eq,
                cleanEmail
            ),
            transaction: t,
            lock: t.LOCK.UPDATE  // Lock the user row
        });

        if (!user) {
            // Debug: fetch all users to see what's in DB
            const allUsers = await User.findAll();
            console.error(`[DEBUG] User not found. All users in DB:`, allUsers.map(u => ({ id: u.id, email: u.email })));
            await t.rollback();
            console.error(`CRITICAL: Webhook received for ${cleanEmail} but User not found in DB!`);
            return 'user_not_found';
        }

        // 3. Prevent Double Crediting (Check using Flutterwave's unique transaction ID)
        const exists = await Transaction.findOne({ 
            where: { flw_transaction_id: flwTxId },
            transaction: t 
        });
        if (exists) {
            await t.rollback();
            console.log(`Transaction ${flwTxId} (tx_ref: ${txRef}) already processed.`);
            return 'duplicate';
        }

        // 4. Update Balance (Now safe from race conditions due to row lock)
        await user.increment('wallet_balance', { by: amount, transaction: t });
        
        try {
            await Transaction.create({
                UserId: user.id,
                amount,
                tx_ref: txRef,
                flw_transaction_id: flwTxId,
                type: 'deposit',
                status: 'successful',
                narration: 'Wallet Top-up via Transfer'
            }, { transaction: t });
        } catch (txError) {
            console.error("Transaction.create validation error:", JSON.stringify(txError.errors, null, 2));
            throw txError;
        }

        await t.commit();
        
        // RELOAD to see the real new balance in logs
        await user.reload(); 
        console.log(`SUCCESS: ${cleanEmail} credited ₦${amount}. New Balance: ₦${user.wallet_balance}`);
        return true;

    } catch (error) {
        if (!t.finished) await t.rollback();
        console.error("DB UPDATE FAILED:", error.message);
        throw error;
    }
}

static refundTransaction = async (reference) => {
    // Start a managed transaction
    const t = await sequelize.transaction();

    try {
        // 1. Find the transaction
        const tx = await Transaction.findOne({ 
            where: { tx_ref: reference },
            transaction: t 
        });

        if (!tx) throw new Error("Transaction record not found");

        // 2. Critical Check: Avoid double refunds
        if (tx.status === 'refunded' || tx.status === 'failed_and_refunded') {
            throw new Error("Transaction has already been refunded");
        }

        // 3. Find the User
        const user = await User.findByPk(tx.UserId, { transaction: t });
        if (!user) throw new Error("User not found");

        // 4. Update Balance
        await user.increment('wallet_balance', { by: tx.amount, transaction: t });

        // 5. Update original transaction status
        await tx.update({ status: 'failed_and_refunded' }, { transaction: t });

        // 6. Create a NEW history entry for the refund
        await Transaction.create({
            UserId: user.id,
            amount: tx.amount,
            type: 'refund',
            status: 'successful',
            tx_ref: `REF-${Date.now()}-${reference}`,
            description: `Auto-refund for failed withdrawal: ${reference}`
        }, { transaction: t });

        // If we got here, commit all changes
        await t.commit();
        return { success: true };

    } catch (error) {
        // If anything fails, undo every step above
        await t.rollback();
        throw error;
    }
  }

    // 7. Purchase Asset (Reserve funds into an escrow transaction)
    static async purchaseAsset(userId, amount, assetId = null, assetShare = null) {
    const t = await sequelize.transaction();
    try {
        // Lock user
        const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!user) throw new Error('User not found');

        if (parseFloat(user.wallet_balance) < parseFloat(amount)) {
            throw new Error('Insufficient Funds');
        }

        // Deduct (reserve) funds
        await user.decrement('wallet_balance', { by: amount, transaction: t });

        const tx_ref = `PUR-${userId}-${Date.now()}`;

        const tx = await Transaction.create({
            UserId: user.id,
            amount,
            tx_ref,
            type: 'purchase',
            status: 'pending',
            narration: 'Purchase reservation (escrow)',
            is_escrow: true,
            escrow_status: 'pending',
            asset_id: assetId,
            asset_share: assetShare
        }, { transaction: t });

        await t.commit();
        return tx;
    } catch (error) {
        if (!t.finished) await t.rollback();
        throw error;
    }
    }

    // 8. Release Escrow (mark escrow as released and complete purchase)
    static async releaseEscrow(tx_ref) {
        const t = await sequelize.transaction();
        try {
            const tx = await Transaction.findOne({ where: { tx_ref }, transaction: t, lock: t.LOCK.UPDATE });
            if (!tx) throw new Error('Escrow transaction not found');
            if (!tx.is_escrow) throw new Error('Transaction is not an escrow');
            if (tx.escrow_status === 'released') throw new Error('Escrow already released');

            // Mark as released
            await tx.update({ status: 'released', escrow_status: 'released', narration: 'Escrow released - purchase completed' }, { transaction: t });

            await t.commit();
            return tx;
        } catch (error) {
            if (!t.finished) await t.rollback();
            throw error;
        }
    }

    // 9. Cancel Escrow (refund reserved funds back to user)
    static async cancelEscrow(tx_ref) {
    const t = await sequelize.transaction();
    try {
        const tx = await Transaction.findOne({ where: { tx_ref }, transaction: t, lock: t.LOCK.UPDATE });
        if (!tx) throw new Error('Escrow transaction not found');
        if (!tx.is_escrow) throw new Error('Transaction is not escrow');
        if (tx.escrow_status === 'cancelled') throw new Error('Escrow already cancelled');

        // Find user and refund
        const user = await User.findByPk(tx.UserId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!user) throw new Error('User not found');

        // Credit back the reserved amount
        await user.increment('wallet_balance', { by: tx.amount, transaction: t });

        // Mark escrow cancelled
        await tx.update({ status: 'cancelled', escrow_status: 'cancelled', narration: 'Escrow cancelled - funds returned' }, { transaction: t });

        // Create refund record
        await Transaction.create({
            UserId: user.id,
            amount: tx.amount,
            type: 'refund',
            status: 'successful',
            tx_ref: `CREF-${Date.now()}-${tx_ref}`,
            narration: `Escrow cancellation refund for ${tx_ref}`
        }, { transaction: t });

        await t.commit();
        return { success: true, refundedAmount: tx.amount };
    } catch (error) {
        if (!t.finished) await t.rollback();
        throw error;
    }
}
}

module.exports = WalletService;
