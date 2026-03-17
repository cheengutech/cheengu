// ============================================================================
// FILE: src/handlers/twilio-webhook.js
// CHEENGU V2: Main SMS router
// ============================================================================

const { handleSetupFlow } = require('./setup');
const { handleInviteResponse } = require('./invite');
const { handleCheckInResponse, handleStatusRequest } = require('./checkin');
const { sendSMS } = require('../services/sms');

async function handleIncomingSMS(phone, message) {
  console.log(`📥 Incoming: ${phone} -> "${message}"`);
  
  const trimmed = message.trim();
  const upper = trimmed.toUpperCase();

  // ============================================
  // PRIORITY 1: Universal commands
  // ============================================
  
  if (upper === 'HELP' || upper === 'HOW') {
    await sendSMS(phone, 
      `CHEENGU\n\n` +
      `START - Create a challenge\n` +
      `MATCH - Join a challenge\n` +
      `STATUS - Check standings\n` +
      `YES/NO - Daily check-in`
    );
    return;
  }

  if (upper === 'STATUS') {
    const handled = await handleStatusRequest(phone);
    if (handled) return;
  }

  // MATCH is a shortcut to START with matching
  if (upper === 'MATCH') {
    // Treat as START, will offer MATCH option
    await handleSetupFlow(phone, 'START');
    return;
  }

  // ============================================
  // PRIORITY 2: Setup flow (START, or in-progress)
  // ============================================
  
  const setupHandled = await handleSetupFlow(phone, message);
  if (setupHandled) return;

  // ============================================
  // PRIORITY 3: Invite responses (YES/NO for pending invites)
  // ============================================
  
  const inviteHandled = await handleInviteResponse(phone, message);
  if (inviteHandled) return;

  // ============================================
  // PRIORITY 4: Check-in responses (YES/NO for daily check-ins)
  // ============================================
  
  const checkInHandled = await handleCheckInResponse(phone, message);
  if (checkInHandled) return;

  // ============================================
  // FALLBACK: Unknown message
  // ============================================
  
  await sendSMS(phone, 
    `Text START to create a challenge\nText STATUS to check standings`
  );
}

module.exports = { handleIncomingSMS };