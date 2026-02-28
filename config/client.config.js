const axios = require('axios');

const client = axios.create({
    baseURL: 'https://api.flutterwave.com/v3',
    headers: {
        Authorization: `Bearer ${process.env.flw_secret_key}`,
        'Content-type': 'application/json'
    }
});

module.exports = client;