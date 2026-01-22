// ============================================================================
// FILE: src/services/sms.js
// ============================================================================

const { twilioClient, CHEENGU_PHONE } = require('../config/twilio');

async function sendSMS(to, body) {
    try {
      if (!to || !to.startsWith('+') || to.length < 11) {
        console.warn(`Skipping SMS send to invalid number: ${to}`);
        return;
      }
  
      await client.messages.create({
        to,
        from: process.env.TWILIO_PHONE_NUMBER,
        body,
      });
    } catch (err) {
      console.error('Non-fatal SMS send failure:', err.message);
    }
  }
  
  

module.exports = { sendSMS };
