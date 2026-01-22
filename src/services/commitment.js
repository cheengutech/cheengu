// ============================================================================
// FILE: src/services/commitment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');
const { FAILURE_PENALTY } = require('../config/stripe');

async function handleFailure(user, log) {
  const newStake = parseFloat(user.stake_remaining) - FAILURE_PENALTY;
  
  await supabase
    .from('daily_logs')
    .update({
      judge_verified: false,
      outcome: 'fail'
    })
    .eq('id', log.id);

  await supabase
    .from('users')
    .update({ stake_remaining: Math.max(0, newStake) })
    .eq('id', user.id);

  await supabase.from('payouts').insert({
    judge_phone: user.judge_phone,
    amount: FAILURE_PENALTY,
    user_id: user.id,
    reason: `Failure on ${log.date}`
  });

  await sendSMS(
    user.phone,
    `Day marked as FAIL. -$${FAILURE_PENALTY}. Stake: $${Math.max(0, newStake)}`
  );
  
  await sendSMS(
    user.judge_phone,
    `Day marked as FAIL. You earned $${FAILURE_PENALTY}.`
  );

  if (newStake <= 0) {
    await endCommitment(user.id, 'stake_depleted');
  }
}

async function endCommitment(userId, reason) {
  const { data: user } = await supabase
    .from('users')
    .update({ status: 'completed' })
    .eq('id', userId)
    .select()
    .single();

  const message = reason === 'stake_depleted' 
    ? 'Your stake is depleted. Commitment ended.'
    : 'Your 7-day commitment is complete.';

  await sendSMS(user.phone, message);
}

module.exports = { handleFailure, endCommitment };