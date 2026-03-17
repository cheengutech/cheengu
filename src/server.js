require('dotenv').config();
const express = require('express');
const path = require('path');
const twilioWebhook = require('./src/handlers/twilio-webhook');
const stripeWebhook = require('./src/handlers/stripe-webhook');
const { startDailyCronJobs } = require('./src/services/scheduler');
const { stripe } = require('./src/config/stripe');
const { triggerStart, verifyApiKey } = require('./src/routes/signup');
const { sendVerificationCode, verifyCodeAndGetDashboard } = require('./src/routes/dashboard');

const app = express();

const cors = require('cors');

app.use(cors({
  origin: ['https://www.cheengu.com', 'https://cheengu.com'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// IMPORTANT: Stripe webhook must use raw body - handle it BEFORE any other middleware
app.post('/stripe-webhook', 
  express.raw({ type: 'application/json' }), 
  (req, res) => {
    console.log('🔔 Stripe webhook received');
    console.log('Body type:', typeof req.body);
    console.log('Is Buffer:', Buffer.isBuffer(req.body));
    stripeWebhook(req, res);
  }
);

// Other middleware (AFTER stripe webhook)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log('INCOMING:', req.method, req.path);
  next();
});

// Twilio webhook
app.post('/sms', twilioWebhook);

// Signup API
app.post('/api/signup', triggerStart);

// Dashboard API routes
app.post('/api/dashboard/send-code', sendVerificationCode);
app.post('/api/dashboard/verify', verifyCodeAndGetDashboard);

// Payment intent endpoint for pay page
app.get('/api/payment-intent/:id', async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(req.params.id);
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Error retrieving payment intent:', error);
    res.status(400).json({ error: 'Invalid payment intent' });
  }
});

// Health check
app.get('/health', (req, res) => {
  console.log('🏓 Keep-alive ping');
  res.status(200).send('OK');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startDailyCronJobs();
});