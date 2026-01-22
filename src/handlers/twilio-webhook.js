// src/handlers/twilio-webhook.js

const { handleSetupFlow } = require('./setup');
const { handleJudgeResponse, handleJudgeVerification } = require('./judge');
const { handleUserClaim } = require('./daily');

async function twilioWebhook(req, res) {
  const { From: phone, Body: message } = req.body;

  console.log(`📨 Received from ${phone}: ${message}`);

  try {
    // Priority: judge consent > judge verification > user claim > setup

    if (await handleJudgeResponse(phone, message)) {
      return res.type('text/xml').status(200).send('<Response></Response>');
    }

    if (await handleJudgeVerification(phone, message)) {
      return res.type('text/xml').status(200).send('<Response></Response>');
    }

    if (await handleUserClaim(phone, message)) {
      return res.type('text/xml').status(200).send('<Response></Response>');
    }

    await handleSetupFlow(phone, message);

    return res.type('text/xml').status(200).send('<Response></Response>');
  } catch (error) {
    console.error('Error handling SMS:', error);
    return res.type('text/xml').status(200).send('<Response></Response>');
    // NOTE: even on error, return 200 + TwiML so Twilio doesn't retry
  }
}

module.exports = twilioWebhook;
