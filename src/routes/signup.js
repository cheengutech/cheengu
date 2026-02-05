// src/routes/signup.js
// Add this to your Express backend

const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');

// Simple API key auth (add BACKEND_API_KEY to your .env)
function verifyApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = process.env.NEXT_PUBLIC_BACKEND_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

async function triggerStart(req, res) {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const normalizedPhone = normalizePhone(phone);

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