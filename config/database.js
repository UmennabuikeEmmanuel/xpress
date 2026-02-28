const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
    process.env.DB_NAME || 'fintech_db',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASS || 'Plasmodium@1',
    {
        host: process.env.DB_HOST || 'localhost',
        dialect: 'postgres',
        logging: false,
    }
);

module.exports = sequelize;