// ============================================================================
// FILE: src/config/twilio.js
// ============================================================================

const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const CHEENGU_PHONE = process.env.TWILIO_PHONE_NUMBER;

module.exports = { twilioClient, CHEENGU_PHONE };