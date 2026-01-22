// ============================================================================
// FILE: src/handlers/judge.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone, isValidYesNo } = require('../utils/phone');
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

    await sendSMS(normalizedPhone, 'You accepted. You\'ll get verification requests daily.');
    await sendSMS(judge.users.phone, 'Your judge accepted. Your commitment starts today.');
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

  const today = new Date().toISOString().split('T')[0];
  
  const { data: log } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', judge.user_id)
    .eq('date', today)
    .eq('outcome', 'pending')
    .eq('user_claimed', true)
    .single();

  if (!log) return false;

  if (!isValidYesNo(message)) {
    await sendSMS(normalizedPhone, 'Reply YES or NO only.');
    return true;
  }

  const verified = message.toUpperCase() === 'YES';

  if (verified) {
    await supabase
      .from('daily_logs')
      .update({
        judge_verified: true,
        outcome: 'pass'
      })
      .eq('id', log.id);

    await sendSMS(judge.users.phone, 'Day marked as PASS.');
  } else {
    await handleFailure(judge.users, log);
  }

  return true;
}

module.exports = { handleJudgeResponse, handleJudgeVerification };