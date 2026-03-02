// ============================================================================
// FILE: src/services/commitment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');

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

  await sendSMS(
    user.phone,
    `❌ Day marked as FAIL\n\n💰 ${oldBar} → ${newBar}\n$${oldStake} → $${Math.max(0, newStake)} (-$${penaltyAmount})\n\nText STATUS to check progress or HOW for help.`
  );
  
  // Notify judge
  const userName = user.user_name || user.phone.slice(-4);
  await sendSMS(
    user.judge_phone,
    `Verified: ${userName} did not complete their commitment today.`
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

  // Build report card - compact format
  let userReport = `📊 COMMITMENT COMPLETE\n`;
  userReport += `Goal: ${user.commitment_text}\n`;
  userReport += `Duration: ${startDate} – ${endDate}\n\n`;
  userReport += `Final Result: ${passedDays}/${totalDays} days\n`;
  userReport += `Missed: ${failedDays} day${failedDays !== 1 ? 's' : ''}\n\n`;
  userReport += `Stake: $${penaltyPerDay}/day\n`;
  userReport += `Total Owed: $${totalLost}\n`;
  userReport += `Owed To: ${totalLost > 0 ? judgeName : 'Nobody — Perfect! 🎉'}`;
  
  if (totalLost > 0) {
    userReport += `\n\nSettle up via Venmo, cash, etc.`;
  }
  userReport += `\n\nText START for a new commitment.`;

  // Judge report
  let judgeReport = `📊 COMMITMENT COMPLETE\n`;
  judgeReport += `Goal: ${user.commitment_text}\n`;
  judgeReport += `Duration: ${startDate} – ${endDate}\n\n`;
  judgeReport += `Final Result: ${passedDays}/${totalDays} days\n`;
  judgeReport += `Missed: ${failedDays} day${failedDays !== 1 ? 's' : ''}\n\n`;
  judgeReport += `Stake: $${penaltyPerDay}/day\n`;
  judgeReport += `Total Owed: $${totalLost}\n`;
  judgeReport += `Owed To: ${totalLost > 0 ? 'You' : 'Nobody — Perfect! 🎉'}`;
  
  if (totalLost > 0) {
    judgeReport += `\n\nSettle up via Venmo, cash, etc.`;
  }
  judgeReport += `\n\nThanks for judging.`;

  // Send report cards
  await sendSMS(user.phone, userReport);
  await sendSMS(user.judge_phone, judgeReport);
  
  console.log(`📊 Report cards sent for ${userName}'s commitment`);
}

module.exports = { handleFailure, endCommitment };