// ============================================================================
// FILE: src/services/commitment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS, sendSMSWithAIGif } = require('./sms');

async function handleFailure(user, log) {
  // Use the user's custom penalty amount, or default to $5
  const penaltyAmount = user.penalty_per_failure || 5;
  const oldStake = parseFloat(user.stake_remaining);
  const newStake = oldStake - penaltyAmount;
  const originalStake = user.original_stake || 20;
  
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

  // Track the penalty
  await supabase.from('payouts').insert({
    judge_phone: user.judge_phone,
    amount: penaltyAmount,
    user_id: user.id,
    reason: `Failure on ${log.date}`
  });

  // Build visual stake bars (before and after)
  const oldPercent = Math.round((oldStake / originalStake) * 10);
  const newPercent = Math.round((Math.max(0, newStake) / originalStake) * 10);
  const oldBar = '🟩'.repeat(oldPercent) + '⬜'.repeat(10 - oldPercent);
  const newBar = '🟩'.repeat(newPercent) + '⬜'.repeat(10 - newPercent);

  // Regular SMS for normal failures
  await sendSMS(
    user.phone,
    `FAIL.\n\n${oldBar} → ${newBar}\n$${oldStake} → $${Math.max(0, newStake)} (-$${penaltyAmount})\n\nDo better tomorrow.`
  );
  
  // Notify judge
  const userName = user.user_name || user.phone.slice(-4);
  await sendSMS(
    user.judge_phone,
    `Verified: ${userName} failed today.`
  );

  if (newStake <= 0) {
    await endCommitment(user.id, 'stake_depleted');
  }
}

async function endCommitment(userId, reason) {
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) {
    console.error('❌ User not found for endCommitment:', userId);
    return;
  }

  // Get all daily logs for this commitment
  const { data: logs } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });

  // Calculate stats
  const totalDays = logs?.length || 0;
  const passedDays = logs?.filter(l => l.outcome === 'pass').length || 0;
  const failedDays = logs?.filter(l => l.outcome === 'fail').length || 0;
  
  const originalStake = user.original_stake || 20;
  const stakeRemaining = Math.max(0, parseFloat(user.stake_remaining));
  const totalLost = originalStake - stakeRemaining;
  const penaltyPerDay = user.penalty_per_failure || 5;
  
  const userName = user.user_name || 'User';
  const judgeName = user.judge_name || 'Judge';
  
  // Format dates
  const startDate = new Date(user.commitment_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDate = new Date(user.commitment_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Update user status
  await supabase
    .from('users')
    .update({ status: 'completed' })
    .eq('id', userId);

  // Determine if perfect, partial, or total loss
  const isPerfect = failedDays === 0;
  const isStakeDepleted = reason === 'stake_depleted';

  // Build report card - drill sergeant style
  let userReport = `MISSION ${isPerfect ? 'ACCOMPLISHED' : 'COMPLETE'}.\n\n`;
  userReport += `"${user.commitment_text}"\n`;
  userReport += `${startDate} – ${endDate}\n\n`;
  userReport += `Result: ${passedDays}/${totalDays} days\n`;
  
  if (isPerfect) {
    userReport += `\nPerfect record. Outstanding, soldier.`;
  } else if (isStakeDepleted) {
    userReport += `Missed: ${failedDays}\n\n`;
    userReport += `Stake: GONE. All $${originalStake} owed to ${judgeName}.\n\n`;
    userReport += `Settle up. Then text START and try again.`;
  } else {
    userReport += `Missed: ${failedDays}\n\n`;
    userReport += `Owed to ${judgeName}: $${totalLost}\n\n`;
    userReport += `Settle up via Venmo, cash, etc.\n\nText START for a new mission.`;
  }

  // Judge report
  let judgeReport = `COMMITMENT COMPLETE.\n\n`;
  judgeReport += `"${user.commitment_text}"\n`;
  judgeReport += `${startDate} – ${endDate}\n\n`;
  judgeReport += `Result: ${passedDays}/${totalDays} days\n`;
  
  if (isPerfect) {
    judgeReport += `\nPerfect. ${userName} crushed it.`;
  } else {
    judgeReport += `Missed: ${failedDays}\n\n`;
    judgeReport += `${userName} owes you: $${totalLost}\n\n`;
    judgeReport += `Collect via Venmo, cash, etc.`;
  }

  // HIGH-IMPACT MOMENTS: Send with AI GIF
  if (isPerfect) {
    // Perfect completion - celebration GIF
    await sendSMSWithAIGif(user.phone, userReport, 'complete');
    await sendSMS(user.judge_phone, judgeReport);
  } else if (isStakeDepleted) {
    // Lost everything - game over GIF
    await sendSMSWithAIGif(user.phone, userReport, 'failure');
    await sendSMS(user.judge_phone, judgeReport);
  } else {
    // Partial completion - regular SMS
    await sendSMS(user.phone, userReport);
    await sendSMS(user.judge_phone, judgeReport);
  }
  
  console.log(`📊 Report cards sent for ${userName}'s commitment (${isPerfect ? 'PERFECT' : isStakeDepleted ? 'DEPLETED' : 'partial'})`);
}

module.exports = { handleFailure, endCommitment };