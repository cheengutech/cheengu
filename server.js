// ============================================================================
// FILE: server.js
// ============================================================================

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const twilioWebhook = require('./src/handlers/twilio-webhook');
const stripeWebhook = require('./src/handlers/stripe-webhook');
const { startDailyCronJobs } = require('./src/services/scheduler');

const app = express();

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// Routes
app.post('/sms', twilioWebhook);
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start cron jobs
startDailyCronJobs();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Cheengu server running on port ${PORT}`);
  console.log(`📱 Twilio webhook: POST /sms`);
  console.log(`💳 Stripe webhook: POST /stripe-webhook`);
});
