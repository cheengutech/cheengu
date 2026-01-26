// src/handlers/twilio-webhook.js

const { handleSetupFlow } = require('./setup');
const { handleJudgeResponse, handleJudgeVerification } = require('./judge');

async function twilioWebhook(req, res) {
  const { From: phone, Body: message } = req.body;
  
  console.log(`📨 Received from ${phone}: ${message}`);

  try {
    // Priority: judge consent > judge verification > setup
    
    const judgeConsentHandled = await handleJudgeResponse(phone, message);
    if (judgeConsentHandled) {
      return res.status(200).send('<Response></Response>');
    }

    const judgeVerificationHandled = await handleJudgeVerification(phone, message);
    if (judgeVerificationHandled) {
      return res.status(200).send('<Response></Response>');
    }

    // If not a judge response, treat as setup flow
    await handleSetupFlow(phone, message);
    
    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error('Error handling SMS:', error);
    res.status(500).send('<Response></Response>');
  }
}

module.exports = twilioWebhook;