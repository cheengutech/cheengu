// src/handlers/judge.js

const supabase = require('../config/database');
const { sendSMS } = require('../services/sms');
const { handleFailure } = require('../services/commitment');
const { getTodayDate } = require('../utils/timezone');

function normalizePhone(phone) {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  // Add +1 if it's a 10-digit US number
  if (digits.length === 10) {
    return '+1' + digits;
  }
  // Add + if missing
  if (!phone.startsWith('+')) {
    return '+' + digits;
  }
  return phone;
}

function isValidYesNo(message) {
  const normalized = message.trim().toUpperCase();
  return normalized === 'YES' || normalized === 'NO';
}

async function handleJudgeResponse(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  const { data: judge } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', normalizedPhone)
    .eq('consent_status', 'pending')
    .single();

  if (!judge) return false;

  // Case-insensitive check with trim
  if (message.trim().toUpperCase() === 'YES') {
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
  
  console.log('🔍 Checking if judge verification:', normalizedPhone, message);
  
  const { data: judge } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', normalizedPhone)
    .eq('consent_status', 'accepted')
    .single();

  console.log('👨‍⚖️ Judge lookup result:', judge);

  if (!judge) {
    console.log('❌ Not a judge or not accepted');
    return false;
  }

  const today = getTodayDate(judge.users.timezone);
  
  console.log('📅 Looking for pending log on date:', today);
  
  const { data: log } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', judge.user_id)
    .eq('date', today)
    .eq('outcome', 'pending')
    .single();

  console.log('📋 Log lookup result:', log);

  if (!log) {
    console.log('❌ No pending log found for today');
    return false;
  }

  if (!isValidYesNo(message)) {
    console.log('⚠️ Invalid response, must be YES or NO');
    await sendSMS(normalizedPhone, 'Reply YES or NO only.');
    return true;
  }

  const verified = message.trim().toUpperCase() === 'YES';
  console.log('✅ Judge verified:', verified);

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