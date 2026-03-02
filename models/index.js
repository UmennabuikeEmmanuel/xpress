const { DataTypes } = require('sequelize');
const sequelize = require('./../config/database');

// 1. User Model (Stores Balance & Virtual Account)
const User = sequelize.define('User', {
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false }, // ADD THIS
    firstname: { type: DataTypes.STRING },
    lastname: { type: DataTypes.STRING },
    pin: { type: DataTypes.STRING },
    wallet_balance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
    account_number: { type: DataTypes.STRING }, 
    bank_name: { type: DataTypes.STRING },      
});

// 2. Transaction Model (Audit Log)
const Transaction = sequelize.define('Transaction', {
    amount: { type: DataTypes.DECIMAL(14, 2) },
    tx_ref: {
    type: DataTypes.STRING,
    allowNull: true
     },
    flw_transaction_id: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true  // Only this is unique (Flutterwave's transaction ID)
     },
    // Types now include purchases and refunds
    type: { type: DataTypes.ENUM('deposit', 'withdrawal', 'purchase', 'refund'), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'successful', 'failed', 'refunded', 'failed_and_refunded', 'released', 'cancelled'), defaultValue: 'pending' },
    narration: { type: DataTypes.STRING },
    // Escrow & Asset fields
    is_escrow: { type: DataTypes.BOOLEAN, defaultValue: false },
    escrow_status: { type: DataTypes.ENUM('pending', 'released', 'cancelled'), allowNull: true },
    asset_id: { type: DataTypes.INTEGER, allowNull: true },
    asset_share: { type: DataTypes.DECIMAL(6,2), allowNull: true }
});

// Relationships
User.hasMany(Transaction);
Transaction.belongsTo(User);

module.exports = { sequelize, User, Transaction };
