// ============================================================================
// FILE: src/handlers/invite.js
// CHEENGU V2: Handle invite responses (YES/NO)
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');

async function handleInviteResponse(phone, message) {
  const upper = message.trim().toUpperCase();
  
  // Only handle YES or NO
  if (upper !== 'YES' && upper !== 'NO') {
    return false;
  }

  // Find pending invite for this phone
  const { data: participant } = await supabase
    .from('participants')
    .select('*, challenges(*)')
    .eq('phone', phone)
    .eq('status', 'invited')
    .order('invited_at', { ascending: false })
    .limit(1)
    .single();

  if (!participant) {
    return false; // No pending invite
  }

  const challenge = participant.challenges;

  if (upper === 'YES') {
    // Accept invite
    await supabase
      .from('participants')
      .update({ 
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', participant.id);

    await sendSMS(phone, `You're in.\n\n"${challenge.goal}"\n$${challenge.stake_amount} on the line.\n\nWaiting for others to accept.`);

    // Notify creator
    await sendSMS(
      challenge.created_by_phone, 
      `${participant.name} accepted the challenge.`
    );

    // Check if we can start the challenge
    await checkAndStartChallenge(challenge.id);

    return true;
  }

  if (upper === 'NO') {
    // Decline invite
    await supabase
      .from('participants')
      .update({ status: 'declined' })
      .eq('id', participant.id);

    await sendSMS(phone, "No problem.");

    // Notify creator
    await sendSMS(
      challenge.created_by_phone,
      `${participant.name} declined.`
    );

    return true;
  }

  return false;
}

async function checkAndStartChallenge(challengeId) {
  // Get challenge and participants
  const { data: challenge } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .single();

  if (!challenge || challenge.status !== 'pending') {
    return;
  }

  const { data: participants } = await supabase
    .from('participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('status', 'accepted');

  const acceptedCount = participants?.length || 0;

  // Need at least 3 people (creator + 2 friends) to start
  if (acceptedCount >= 3) {
    await startChallenge(challengeId, challenge, participants);
  }
}

async function startChallenge(challengeId, challenge, participants) {
  // Start TODAY if before 6pm, otherwise tomorrow
  const now = new Date();
  const hour = now.getHours();
  
  let startDate;
  if (hour < 18) {
    // Before 6pm - start today
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
  } else {
    // After 6pm - start tomorrow
    startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);
  }
  
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + challenge.duration_days - 1);

  // Update challenge
  await supabase
    .from('challenges')
    .update({
      status: 'active',
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0]
    })
    .eq('id', challengeId);

  // Build player list
  const playerNames = participants.map(p => p.name).join(', ');
  const startsWhen = hour < 18 ? 'TODAY' : 'TOMORROW';

  // Notify all accepted participants with URGENCY
  for (const p of participants) {
    const msg = `GO TIME.\n\n` +
      `"${challenge.goal}"\n\n` +
      `Players: ${playerNames}\n` +
      `Stake: $${challenge.stake_amount}\n` +
      `Days: ${challenge.duration_days}\n\n` +
      `Starts: ${startsWhen}\n` +
      `Check-in: 9pm daily\n\n` +
      `No response = miss.\n` +
      `Losers pay winners.\n\n` +
      `Don't fall behind Day 1.`;

    await sendSMS(p.phone, msg);
  }

  console.log(`✅ Challenge ${challengeId} started with ${participants.length} players`);
}

module.exports = { handleInviteResponse, checkAndStartChallenge };