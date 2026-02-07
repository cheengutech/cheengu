require('dotenv').config();
const express = require('express');
const path = require('path');
const twilioWebhook = require('./src/handlers/twilio-webhook');
const stripeWebhook = require('./src/handlers/stripe-webhook');
const { startDailyCronJobs } = require('./src/services/scheduler');
const { stripe } = require('./src/config/stripe');
const { triggerStart, verifyApiKey } = require('./src/routes/signup');


const app = express();

const cors = require('cors');

app.use(cors({
  origin: [
    'https://www.cheengu.com', 
    'https://cheengu.com',
    'https://cheengu-v1.onrender.com'  // ← ADD THIS
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log('INCOMING:', req.method, req.path);
  next();
});

app.use(express.json());

// Routes
app.post('/sms', twilioWebhook);
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.post('/api/signup', verifyApiKey, triggerStart);

// Serve payment page for any /pay/* route
app.get('/pay/:paymentIntentId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pay.html'));
});

// API endpoint to get payment intent client secret
app.get('/api/payment-intent/:id', async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(req.params.id);
    const metadata = paymentIntent.metadata || {};
    
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      commitmentName: metadata.commitment || null,
      commitmentType: metadata.commitment_type || 'daily',
      duration: metadata.deadline_date || '7',
      penaltyPerFailure: parseInt(metadata.penalty_amount || '5') * 100
    });
  } catch (error) {
    console.error('Error retrieving payment intent:', error);
    res.status(404).json({ error: 'Payment intent not found' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test DB endpoint (can remove later)
app.get('/test-db', async (req, res) => {
  const { supabase } = require('./src/config/database');
  try {
    const { data, error } = await supabase.from('users').select('count');
    if (error) throw error;
    res.json({ status: 'ok', message: 'Database connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Manual trigger for daily check-in (for testing)
app.get('/test-daily-checkin/:phone', async (req, res) => {
  const { sendDailyCheckIn, sendDeadlineCheckIn } = require('./src/services/scheduler');
  const { supabase } = require('./src/config/database');
  const { normalizePhone } = require('./src/utils/phone');
  
  try {
    const phone = normalizePhone(req.params.phone);
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();
    
    if (!user) {
      return res.status(404).json({ error: 'No active user found with that phone' });
    }
    
    if (user.commitment_type === 'daily') {
      await sendDailyCheckIn(
        user.id, 
        user.phone, 
        user.judge_phone,
        user.commitment_text,
        user.timezone
      );
      res.json({ status: 'ok', message: 'Daily check-in sent!', type: 'daily' });
    } else {
      await sendDeadlineCheckIn(
        user.id,
        user.phone,
        user.judge_phone,
        user.commitment_text,
        user.deadline_date
      );
      res.json({ status: 'ok', message: 'Deadline check-in sent!', type: 'deadline' });
    }
  } catch (error) {
    console.error('Error triggering check-in:', error);
    res.status(500).json({ error: error.message });
  }
});

// Temporary: manually trigger setup finalization
app.get('/manual-finalize/:phone', async (req, res) => {
  const { finalizeSetup } = require('./src/handlers/payment');
  const { normalizePhone } = require('./src/utils/phone');
  
  try {
    const phone = normalizePhone(req.params.phone);
    console.log('🔧 Manual finalize triggered for:', phone);
    await finalizeSetup(phone);
    res.json({ status: 'ok', message: 'Setup finalized! Judge should receive consent request.' });
  } catch (error) {
    console.error('❌ Manual finalize error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Start cron jobs
startDailyCronJobs();

// Keep server alive - ping every 14 minutes to prevent Render spindown
if (process.env.NODE_ENV === 'production') {
  const https = require('https');
  setInterval(() => {
    https.get(process.env.APP_URL + '/health', (res) => {
      console.log('🏓 Keep-alive ping');
    }).on('error', (err) => {
      console.error('Keep-alive ping failed:', err);
    });
  }, 14 * 60 * 1000); // Every 14 minutes
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Cheengu server running on port ${PORT}`);
  console.log(`📱 Twilio webhook: POST /sms`);
  console.log(`💳 Stripe webhook: POST /stripe-webhook`);
});