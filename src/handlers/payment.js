// ============================================================================
// FILE: src/handlers/payment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');
const { INITIAL_STAKE } = require('../config/stripe');

async function finalizeSetup(phone) {
  const normalizedPhone = normalizePhone(phone);
  
  const { data: setupState } = await supabase
    .from('setup_state')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  if (!setupState) return;

  // Calculate dates based on commitment type
  const startDate = new Date();
  let endDate;
  
  if (setupState.temp_commitment_type === 'deadline') {
    endDate = new Date(setupState.temp_deadline_date);
  } else {
    // Daily type - default 7 days
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
  }

  const { data: user } = await supabase
    .from('users')
    .insert({
      phone: normalizedPhone,
      commitment_text: setupState.temp_commitment,
      commitment_type: setupState.temp_commitment_type || 'daily',
      deadline_date: setupState.temp_commitment_type === 'deadline' ? setupState.temp_deadline_date : null,
      judge_phone: setupState.temp_judge_phone,
      stake_remaining: INITIAL_STAKE,
      status: 'awaiting_judge',
      commitment_start_date: startDate.toISOString().split('T')[0],
      commitment_end_date: endDate.toISOString().split('T')[0]
    })
    .select()
    .single();

  // Create judge entry
  await supabase.from('judges').insert({
    phone: setupState.temp_judge_phone,
    user_id: user.id,
    consent_status: 'pending'
  });

  // Send judge consent request
  const commitmentTypeText = user.commitment_type === 'daily' 
    ? 'daily habit commitment'
    : 'deadline-based commitment';
    
  await sendSMS(
    setupState.temp_judge_phone,
    `${normalizedPhone} invited you to be their accountability judge for a ${commitmentTypeText}.\n\nReply YES to accept or ignore to decline.`
  );

  // Clean up setup state
  await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
}

module.exports = { finalizeSetup };

// ============================================================================
// FILE: src/handlers/judge.js
// ============================================================================

const { handleFailure } = require('../services/commitment');

async function handleJudgeResponse(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  const { data: judge } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', normalizedPhone)
    .eq('consent_status', 'pending')
    .single();

  if (!judge) return false;

  if (message.toUpperCase() === 'YES') {
    await supabase
      .from('judges')
      .update({ consent_status: 'accepted' })
      .eq('id', judge.id);

    await supabase
      .from('users')
      .update({ status: 'active' })
      .eq('id', judge.user_id);

    const typeText = judge.users.commitment_type === 'daily' 
      ? 'You\'ll get daily check-in requests.'
      : `You\'ll get one check-in on ${judge.users.deadline_date}.`;
      
    await sendSMS(normalizedPhone, `You accepted. ${typeText}`);
    await sendSMS(judge.users.phone, 'Your judge accepted. Your commitment starts now.');
    return true;
  }

  return false;
}

async function handleJudgeVerification(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  const { data: judge } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', normalizedPhone)
    .eq('consent_status', 'accepted')
    .single();

  if (!judge) return false;

  const { getTodayDate } = require('../utils/timezone');
  const today = getTodayDate(judge.users.timezone);
  
  const { data: log } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', judge.user_id)
    .eq('date', today)
    .eq('outcome', 'pending')
    .single();

  if (!log) return false;

  if (!isValidYesNo(message)) {
    await sendSMS(normalizedPhone, 'Reply YES or NO only.');
    return true;
  }

  const verified = message.toUpperCase() === 'YES';

  if (verified) {
    // PASS
    await supabase
      .from('daily_logs')
      .update({
        judge_verified: true,
        outcome: 'pass'
      })
      .eq('id', log.id);

    await sendSMS(judge.users.phone, 'Day marked as PASS.');
  } else {
    // FAIL
    if (judge.users.commitment_type === 'deadline') {
      // All-or-nothing for deadline
      await handleDeadlineFailure(judge.users);
    } else {
      // Gradual for daily
      await handleFailure(judge.users, log);
    }
  }

  return true;
}

async function handleDeadlineFailure(user) {
  // All-or-nothing: lose entire stake
  await supabase
    .from('users')
    .update({ 
      stake_remaining: 0,
      status: 'completed'
    })
    .eq('id', user.id);

  // Record payout to judge
  await supabase.from('payouts').insert({
    judge_phone: user.judge_phone,
    amount: user.stake_remaining,
    user_id: user.id,
    reason: 'Deadline commitment failed'
  });

  await sendSMS(user.phone, `Commitment FAILED. Lost entire stake: $${user.stake_remaining}`);
  await sendSMS(user.judge_phone, `Commitment FAILED. You earned $${user.stake_remaining}.`);
}

module.exports = { handleJudgeResponse, handleJudgeVerification };

// ============================================================================
// FILE: src/handlers/daily.js (Keep for reference, but not used anymore)
// ============================================================================

async function handleUserClaim(phone, message) {
  // This function is no longer used with judge-only flow
  // Kept for backwards compatibility
  return false;
}

module.exports = { handleUserClaim };