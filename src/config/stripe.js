// ============================================================================
// FILE: src/config/stripe.js
// ============================================================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const INITIAL_STAKE = 20; // $20
const FAILURE_PENALTY = 5; // $5

module.exports = { stripe, INITIAL_STAKE, FAILURE_PENALTY };