// ============================================================================
// FILE: src/handlers/setup.js
// CHEENGU V2: Group Challenge Setup Flow
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');

// Setup steps in order
const STEPS = [
  'awaiting_name',
  'awaiting_goal',
  'awaiting_type',
  'awaiting_stake',
  'awaiting_duration',
  'awaiting_friends',
  'confirming'
];

async function getSetupState(phone) {
  console.log('🔍 Looking for setup state for:', phone);
  const { data, error } = await supabase  // ADD error here
    .from('setup_state')
    .select('*')
    .eq('phone', phone)
    .single();
  console.log('🔍 Setup state result:', data, 'Error:', error);
  return data;
}

async function updateSetupState(phone, step, data = {}) {
  const { data: existing, error: selectError } = await supabase
    .from('setup_state')
    .select('*')
    .eq('phone', phone)
    .single();

    console.log('🔍 Existing state:', existing, 'Error:', selectError);

  if (existing) {
    const mergedData = { ...existing.data, ...data };
    await supabase
      .from('setup_state')
      .update({ 
        step, 
        data: mergedData,
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      })
      .eq('phone', phone);
      console.log('🔍 Update error:', updateError);

  } else {
    await supabase
      .from('setup_state')
      .insert({ 
        phone, 
        step, 
        data,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      });
      console.log('🔍 Insert error:', insertError);

  }
}

async function clearSetupState(phone) {
  await supabase
    .from('setup_state')
    .delete()
    .eq('phone', phone);
}

async function handleSetupFlow(phone, message) {
  console.log('🔍 Setup flow called with phone:', phone);  // ADD THIS
  const state = await getSetupState(phone);
  const upperMessage = message.trim().toUpperCase();

  // Handle QUIT at any point
  if (upperMessage === 'QUIT' || upperMessage === 'CANCEL') {
    await clearSetupState(phone);
    await sendSMS(phone, "Cancelled. Text START when you're ready.");
    return true;
  }

  // No active setup - check for START
  if (!state) {
    if (upperMessage === 'START') {
      await updateSetupState(phone, 'awaiting_name', {});
      await sendSMS(phone, "Let's build a challenge.\n\nWhat's your name?");
      return true;
    }
    return false; // Not a setup message
  }

  // Route to current step handler
  switch (state.step) {
    case 'awaiting_name':
      return await handleName(phone, message, state);
    case 'awaiting_goal':
      return await handleGoal(phone, message, state);
    case 'awaiting_type':
      return await handleType(phone, message, state);
    case 'awaiting_stake':
      return await handleStake(phone, message, state);
    case 'awaiting_duration':
      return await handleDuration(phone, message, state);
    case 'awaiting_group_type':
      return await handleGroupType(phone, message, state);
    case 'awaiting_friends':
      return await handleFriends(phone, message, state);
    case 'confirming':
      return await handleConfirm(phone, message, state);
    default:
      await clearSetupState(phone);
      return false;
  }
}

// ============================================================================
// STEP HANDLERS
// ============================================================================

async function handleName(phone, message, state) {
  const name = message.trim();
  
  if (name.length < 1 || name.length > 30) {
    await sendSMS(phone, "Keep it short. What's your name?");
    return true;
  }

  await updateSetupState(phone, 'awaiting_goal', { name });
  await sendSMS(phone, `${name}. Good.\n\nWhat's the challenge? Be specific.\n\n(e.g., "Run 1 mile" or "No alcohol")`);
  return true;
}

async function handleGoal(phone, message, state) {
  const goal = message.trim();
  
  if (goal.length < 3 || goal.length > 200) {
    await sendSMS(phone, "Too short or too long. What's the challenge?");
    return true;
  }

  await updateSetupState(phone, 'awaiting_type', { goal });
  await sendSMS(phone, `"${goal}"\n\nHow does it work?\n\nDAILY - Do it every day\nDEADLINE - Complete by end date\n\nReply DAILY or DEADLINE`);
  return true;
}

async function handleType(phone, message, state) {
  const upper = message.trim().toUpperCase();
  
  if (upper !== 'DAILY' && upper !== 'DEADLINE') {
    await sendSMS(phone, "Reply DAILY or DEADLINE");
    return true;
  }

  const type = upper.toLowerCase();
  await updateSetupState(phone, 'awaiting_stake', { commitment_type: type });
  await sendSMS(phone, `${upper} it is.\n\nHow much does everyone put in? ($5 - $100)\n\nPick an amount that hurts to lose.`);
  return true;
}

async function handleStake(phone, message, state) {
  const amount = parseInt(message.replace(/[$,]/g, ''));
  
  if (isNaN(amount) || amount < 5 || amount > 100) {
    await sendSMS(phone, "$5 to $100. How much?");
    return true;
  }

  await updateSetupState(phone, 'awaiting_duration', { stake_amount: amount });
  await sendSMS(phone, `$${amount} per person.\n\nHow many days? (3-30)\n\nShorter = more intense.`);
  return true;
}

async function handleDuration(phone, message, state) {
  const days = parseInt(message);
  
  if (isNaN(days) || days < 3 || days > 30) {
    await sendSMS(phone, "3 to 30 days. How long?");
    return true;
  }

  await updateSetupState(phone, 'awaiting_group_type', { 
    duration_days: days,
    friends: []
  });
  
  await sendSMS(phone, `${days} days.\n\nHow do you want to compete?\n\nINVITE - Add friends by phone\nMATCH - Join others with the same goal\n\nReply INVITE or MATCH`);
  return true;
}

async function handleGroupType(phone, message, state) {
  const upper = message.trim().toUpperCase();
  
  if (upper !== 'INVITE' && upper !== 'MATCH') {
    await sendSMS(phone, "Reply INVITE or MATCH");
    return true;
  }

  if (upper === 'MATCH') {
    // Simulate matching momentum
    await updateSetupState(phone, 'matching', {});
    
    // Create challenge immediately in pending-match state
    const d = state.data;
    
    const { data: challenge } = await supabase
      .from('challenges')
      .insert({
        goal: d.goal,
        stake_amount: d.stake_amount,
        duration_days: d.duration_days,
        commitment_type: d.commitment_type,
        created_by_phone: phone,
        created_by_name: d.name,
        status: 'matching'
      })
      .select()
      .single();

    // Add creator as participant
    await supabase
      .from('participants')
      .insert({
        challenge_id: challenge.id,
        phone: phone,
        name: d.name,
        status: 'accepted',
        is_creator: true,
        accepted_at: new Date().toISOString()
      });

    await clearSetupState(phone);

    // Simulate lobby feel
    await sendSMS(phone, `You're in.\n\n"${d.goal}"\n$${d.stake_amount} stake\n\n2/5 spots filled. Matching you with others now.\n\nWe'll notify you when the group is ready.`);
    
    // Try to match with existing pending challenges
    await tryMatchPendingChallenges(challenge.id, d.goal);
    
    return true;
  }

  // INVITE flow
  await updateSetupState(phone, 'awaiting_friends', {});
  await sendSMS(phone, `Add 2-5 friends:\n\nFormat: Name Phone\nExample: John 555-123-4567\n\nReply DONE when finished`);
  return true;
}

async function tryMatchPendingChallenges(challengeId, goal) {
  // Find other challenges with similar goals in 'matching' status
  const { data: matches } = await supabase
    .from('challenges')
    .select('*, participants(*)')
    .eq('status', 'matching')
    .neq('id', challengeId)
    .limit(5);

  // Simple matching: combine if goals are similar enough
  // For now, just check for exact match (could use AI similarity later)
  for (const match of matches || []) {
    if (match.goal.toLowerCase() === goal.toLowerCase()) {
      // Merge participants into one challenge
      await mergeChallenge(challengeId, match.id);
      return;
    }
  }
  
  // No match found - they'll wait
  console.log(`⏳ No match found for challenge ${challengeId}, waiting for more players`);
}

async function handleFriends(phone, message, state) {
  const upper = message.trim().toUpperCase();
  
  // Check if done adding friends
  if (upper === 'DONE') {
    const friends = state.data.friends || [];
    
    if (friends.length < 2) {
      await sendSMS(phone, "Need at least 2 friends. Add more or this isn't a competition.");
      return true;
    }
    
    // Move to confirmation
    await updateSetupState(phone, 'confirming', {});
    return await showConfirmation(phone, state);
  }

  // Parse friend: "John 555-123-4567" or "John 5551234567"
  const match = message.match(/^([a-zA-Z]+)\s*(\+?[\d\s\-\(\)]{10,})/);
  
  if (!match) {
    await sendSMS(phone, "Format: Name PhoneNumber\n\nExample: John 555-123-4567\n\nOr reply DONE if finished.");
    return true;
  }

  const friendName = match[1].trim();
  let friendPhone = match[2].replace(/[\s\-\(\)]/g, '');
  
  // Normalize phone
  if (friendPhone.length === 10) {
    friendPhone = '+1' + friendPhone;
  } else if (!friendPhone.startsWith('+')) {
    friendPhone = '+' + friendPhone;
  }

  // Check not adding self
  if (friendPhone === phone) {
    await sendSMS(phone, "You can't invite yourself. Add someone else.");
    return true;
  }

  // Check for duplicates
  const friends = state.data.friends || [];
  if (friends.some(f => f.phone === friendPhone)) {
    await sendSMS(phone, `${friendName} is already on the list. Add someone else or reply DONE.`);
    return true;
  }

  // Check max friends
  if (friends.length >= 5) {
    await sendSMS(phone, "Max 5 friends. Reply DONE to continue.");
    return true;
  }

  // Add friend
  friends.push({ name: friendName, phone: friendPhone });
  await updateSetupState(phone, 'awaiting_friends', { friends });

  const remaining = 5 - friends.length;
  const minNeeded = Math.max(0, 2 - friends.length);
  
  let response = `Added ${friendName}. (${friends.length}/5)`;
  if (minNeeded > 0) {
    response += `\n\nNeed ${minNeeded} more.`;
  } else {
    response += `\n\nAdd more or reply DONE.`;
  }
  
  await sendSMS(phone, response);
  return true;
}

async function showConfirmation(phone, state) {
  const d = state.data;
  const friendList = d.friends.map(f => f.name).join(', ');
  
  const summary = `CHALLENGE READY\n\n` +
    `Goal: "${d.goal}"\n` +
    `Type: ${d.commitment_type}\n` +
    `Stake: $${d.stake_amount}/person\n` +
    `Duration: ${d.duration_days} days\n` +
    `Players: ${d.name} (you), ${friendList}\n\n` +
    `Reply GO to send invites\n` +
    `Reply CANCEL to start over`;

  await sendSMS(phone, summary);
  return true;
}

async function handleConfirm(phone, message, state) {
  const upper = message.trim().toUpperCase();
  
  if (upper === 'CANCEL') {
    await clearSetupState(phone);
    await sendSMS(phone, "Cancelled. Text START to try again.");
    return true;
  }
  
  if (upper !== 'GO') {
    await sendSMS(phone, "Reply GO to send invites or CANCEL to start over.");
    return true;
  }

  // Create the challenge
  const d = state.data;
  
  const { data: challenge, error: challengeError } = await supabase
    .from('challenges')
    .insert({
      goal: d.goal,
      stake_amount: d.stake_amount,
      duration_days: d.duration_days,
      commitment_type: d.commitment_type,
      created_by_phone: phone,
      created_by_name: d.name,
      status: 'pending'
    })
    .select()
    .single();

  if (challengeError) {
    console.error('Failed to create challenge:', challengeError);
    await sendSMS(phone, "Something went wrong. Try again.");
    return true;
  }

  // Add creator as participant (auto-accepted)
  await supabase
    .from('participants')
    .insert({
      challenge_id: challenge.id,
      phone: phone,
      name: d.name,
      status: 'accepted',
      is_creator: true,
      accepted_at: new Date().toISOString()
    });

  // Add and invite friends
  for (const friend of d.friends) {
    await supabase
      .from('participants')
      .insert({
        challenge_id: challenge.id,
        phone: friend.phone,
        name: friend.name,
        status: 'invited'
      });

    // Send invite
    const invite = `${d.name} invited you to a challenge:\n\n` +
      `"${d.goal}"\n\n` +
      `Stake: $${d.stake_amount}\n` +
      `Duration: ${d.duration_days} days\n` +
      `Players: ${d.friends.length + 1}\n\n` +
      `Losers pay winners.\n\n` +
      `Reply YES to join or NO to decline.`;

    await sendSMS(friend.phone, invite);
  }

  // Clear setup state
  await clearSetupState(phone);

  // Confirm to creator
  const friendNames = d.friends.map(f => f.name).join(', ');
  await sendSMS(phone, `Invites sent to ${friendNames}.\n\nChallenge starts when at least 2 accept.\n\nWe'll notify you.`);

  return true;
}

async function mergeChallenge(targetId, sourceId) {
  // Move participants from source to target
  const { data: sourceParticipants } = await supabase
    .from('participants')
    .select('*')
    .eq('challenge_id', sourceId);

  for (const p of sourceParticipants || []) {
    await supabase
      .from('participants')
      .update({ challenge_id: targetId })
      .eq('id', p.id);
  }

  // Delete source challenge
  await supabase
    .from('challenges')
    .delete()
    .eq('id', sourceId);

  // Check if target now has enough players to start
  const { data: allParticipants } = await supabase
    .from('participants')
    .select('*')
    .eq('challenge_id', targetId)
    .eq('status', 'accepted');

  if (allParticipants && allParticipants.length >= 3) {
    // Start the challenge
    const { checkAndStartChallenge } = require('./invite');
    await checkAndStartChallenge(targetId);
  } else {
    // Notify participants of progress
    const { data: challenge } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', targetId)
      .single();

    for (const p of allParticipants || []) {
      await sendSMS(p.phone, `${allParticipants.length}/3 players matched.\n\n"${challenge.goal}"\n\nAlmost there.`);
    }
  }

  console.log(`🔗 Merged challenge ${sourceId} into ${targetId}`);
}

module.exports = { handleSetupFlow };