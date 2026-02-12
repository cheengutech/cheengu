const { handleSetupFlow } = require('./setup');
const { handleJudgeResponse, handleJudgeVerification } = require('./judge');
const { handleMenuCommand, handleMenuResponse } = require('./menu');

async function twilioWebhook(req, res) {
  const { From: phone, Body: message } = req.body;
  
  console.log(`📨 Received from ${phone}: ${message}`);

  try {
    // Priority: judge consent > MENU (for judges) > HELP (for users) > judge verification > setup
    
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

    // HOW, STATUS, HISTORY, RESET commands - route to setup flow
    const upperMessage = message.trim().toUpperCase();
    if (upperMessage === 'HOW' || upperMessage === 'STATUS' || upperMessage === 'HISTORY' || upperMessage === 'RESET') {
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