// ============================================================================
// FILE: src/server.js
// CHEENGU V2: Main Express server
// ============================================================================

require('dotenv').config();

const express = require('express');
const { handleIncomingSMS } = require('./handlers/twilio-webhook');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'cheengu-v2',
    version: '2.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Twilio webhook - receives incoming SMS
app.post('/sms', async (req, res) => {
  try {
    const { From: from, Body: body } = req.body;
    
    if (!from || !body) {
      console.error('❌ Missing From or Body in request');
      return res.status(400).send('Missing parameters');
    }

    // Handle the SMS asynchronously
    handleIncomingSMS(from, body).catch(err => {
      console.error('❌ Error handling SMS:', err);
    });

    // Respond immediately to Twilio (empty TwiML = no auto-reply)
    res.type('text/xml').send('<Response></Response>');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Cheengu V2 running on port ${PORT}`);
  
  // Start the scheduler
  startScheduler();
});