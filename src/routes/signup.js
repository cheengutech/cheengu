// src/routes/signup.js

const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');

console.log('BACKEND_API_KEY:', process.env.BACKEND_API_KEY);

// Simple API key auth (add BACKEND_API_KEY to your .env)
function verifyApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = process.env.BACKEND_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// Rate limiting - track recent signups by IP
const recentSignups = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_SIGNUPS_PER_WINDOW = 3;

function checkRateLimit(ip) {
  const now = Date.now();
  const recent = recentSignups.get(ip) || [];
  
  // Filter to only recent attempts
  const recentAttempts = recent.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentAttempts.length >= MAX_SIGNUPS_PER_WINDOW) {
    return false; // Rate limited
  }
  
  // Record this attempt
  recentAttempts.push(now);
  recentSignups.set(ip, recentAttempts);
  
  return true; // Allowed
}

async function triggerStart(req, res) {
  try {
    const { phone, website, email } = req.body;
    
    // Honeypot check - these fields should be empty (hidden from real users)
    // Bots will auto-fill them
    if (website || email) {
      console.log('🤖 Bot detected - honeypot fields filled');
      // Return success to not tip off the bot, but don't actually do anything
      return res.json({ success: true });
    }

    // Rate limiting by IP
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRateLimit(clientIP)) {
      console.log(`⚠️ Rate limited: ${clientIP}`);
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const normalizedPhone = normalizePhone(phone);
    
    // Basic phone validation - must be 10+ digits
    const digitsOnly = normalizedPhone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Send START message
    await sendSMS(
      normalizedPhone,
      "Welcome to Cheengu! 🎯\n\nReply START to begin setting up your accountability commitment."
    );

    console.log(`✅ Triggered START for ${normalizedPhone} from web signup`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error triggering START:', error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
}

module.exports = { triggerStart, verifyApiKey };