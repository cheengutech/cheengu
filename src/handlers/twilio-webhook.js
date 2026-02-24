const { handleSetupFlow } = require('./setup');
const { handleJudgeResponse, handleJudgeVerification } = require('./judge');
const { handleMenuCommand, handleMenuResponse, handleAdminCommand, handleAdminResponse } = require('./menu');

async function twilioWebhook(req, res) {
  const { From: phone, Body: message } = req.body;
  
  console.log(`📨 Received from ${phone}: ${message}`);

  try {
    // Priority: ADMIN > judge consent > MENU > judge verification > setup
    
    // ADMIN command (Brian only)
    if (message.trim().toUpperCase() === 'ADMIN') {
      const handled = await handleAdminCommand(phone);
      if (handled) return res.status(200).send('<Response></Response>');
    }
    
    // Check if admin response (e.g., "3 PASS")
    const adminHandled = await handleAdminResponse(phone, message);
    if (adminHandled) {
      return res.status(200).send('<Response></Response>');
    }
    
    const judgeConsentHandled = await handleJudgeResponse(phone, message);
    if (judgeConsentHandled) {
      return res.status(200).send('<Response></Response>');
    }

    // MENU command for judges
    if (message.trim().toUpperCase() === 'MENU') {
      await handleMenuCommand(phone);
      return res.status(200).send('<Response></Response>');
    }

    // Check if judge is in active menu session
    const menuResponseHandled = await handleMenuResponse(phone, message);
    if (menuResponseHandled) {
      return res.status(200).send('<Response></Response>');
    }

    // HELP/HOW, STATUS, HISTORY, RESET commands - route to setup flow
    const trimmed = message.trim();
    const upperMessage = trimmed.toUpperCase();
    const lowerMessage = trimmed.toLowerCase();

    if (
      upperMessage === 'HELP' ||
      upperMessage === 'HOW' || // legacy alias
      upperMessage === 'STATUS' ||
      upperMessage === 'HISTORY' ||
      upperMessage === 'RESET' ||
      lowerMessage === 'commands' ||
      lowerMessage === '?'
    ) {
      await handleSetupFlow(phone, message);
      return res.status(200).send('<Response></Response>');
    }

    const judgeVerificationHandled = await handleJudgeVerification(phone, message);
    if (judgeVerificationHandled) {
      return res.status(200).send('<Response></Response>');
    }

    await handleSetupFlow(phone, message);
    
    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error('Error handling SMS:', error);
    res.status(500).send('<Response></Response>');
  }
}

module.exports = twilioWebhook;