// src/services/sms.js

const { twilioClient, CHEENGU_PHONE } = require('../config/twilio');

async function sendSMS(to, body) {
  try {
    await twilioClient.messages.create({
      body,
      from: CHEENGU_PHONE,
      to
    });
    console.log(`📤 SMS sent to ${to}: ${body}`);
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${to}:`, error);
    throw error;
  }
}

module.exports = { sendSMS };