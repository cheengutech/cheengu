// src/routes/dashboard.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');

// Store verification codes temporarily (in production, use Redis or database)
const verificationCodes = new Map();
const CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes

function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendVerificationCode(req, res) {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const normalizedPhone = normalizePhone(phone);

    // Check if user exists
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .limit(1);

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    // Generate and store code
    const code = generateCode();
    verificationCodes.set(normalizedPhone, {
      code,
      expiresAt: Date.now() + CODE_EXPIRY
    });

    // Send SMS
    await sendSMS(normalizedPhone, `Your Cheengu verification code is: ${code}\n\nThis code expires in 10 minutes.`);

    console.log(`📱 Dashboard code sent to ${normalizedPhone}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending verification code:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
}

async function verifyCodeAndGetDashboard(req, res) {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone and code required' });
    }

    const normalizedPhone = normalizePhone(phone);

    // Verify code
    const stored = verificationCodes.get(normalizedPhone);
    
    if (!stored) {
      return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
    }

    if (Date.now() > stored.expiresAt) {
      verificationCodes.delete(normalizedPhone);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    if (stored.code !== code) {
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    }

    // Code is valid - clear it
    verificationCodes.delete(normalizedPhone);

    // Get user's active commitment
    const { data: activeCommitment } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .single();

    // Get daily logs for active commitment
    let dailyLogs = [];
    if (activeCommitment) {
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('user_id', activeCommitment.id)
        .order('date', { ascending: true });
      
      dailyLogs = logs || [];
    }

    // Get past commitments
    const { data: pastCommitments } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'completed')
      .order('commitment_end_date', { ascending: false })
      .limit(10);

    // Get user info from most recent record
    const mostRecentUser = activeCommitment || (pastCommitments && pastCommitments[0]) || null;

    console.log(`📊 Dashboard loaded for ${normalizedPhone}`);

    res.json({
      user: {
        phone: normalizedPhone,
        user_name: mostRecentUser?.user_name || null
      },
      activeCommitment: activeCommitment || null,
      dailyLogs,
      pastCommitments: pastCommitments || []
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
}

module.exports = { sendVerificationCode, verifyCodeAndGetDashboard };