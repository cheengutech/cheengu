// ============================================================================
// FILE: src/services/commitment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');
const { stripe } = require('../config/stripe');

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

  // Track the penalty (for your records, not paying out to judge for now)
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
    `❌ Day marked as FAIL\n\n💰 ${oldBar} → ${newBar}\n$${oldStake} → $${Math.max(0, newStake)} (-$${penaltyAmount})\n\nText STATUS to check progress or HELP for help.`
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

  // Calculate refund amount
  const refundAmount = Math.max(0, parseFloat(user.stake_remaining));
  const originalStake = user.original_stake || 20;
  const totalPenalties = originalStake - refundAmount;

  // Issue Stripe refund if there's money to refund and we have a payment intent
  if (refundAmount > 0 && user.payment_intent_id) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: user.payment_intent_id,
        amount: Math.round(refundAmount * 100), // Convert to cents
      });
      console.log(`💰 Refund issued: $${refundAmount} for user ${userId}`, refund.id);
    } catch (error) {
      console.error('❌ Stripe refund failed:', error);
      // Still mark as completed, but flag for manual review
      await supabase
        .from('users')
        .update({ 
          status: 'completed',
          refund_status: 'failed',
          refund_error: error.message
        })
        .eq('id', userId);
      
      await sendSMS(
        user.phone,
        `Your commitment is complete! Refund of $${refundAmount} failed to process automatically. We'll sort this out manually - hang tight!`
      );
      return;
    }
  }

  // Update user status
  await supabase
    .from('users')
    .update({ 
      status: 'completed',
      refund_status: refundAmount > 0 ? 'refunded' : 'no_refund',
      refund_amount: refundAmount
    })
    .eq('id', userId);

  // Send completion message based on reason and outcome
  let message;
  const userName = user.user_name || 'You';
  
  if (reason === 'stake_depleted') {
    message = `😔 Your stake has been fully depleted.\n\nCommitment ended. Don't give up - text START to try again! 💪\n\nView history: cheengu.com/dashboard`;
  } else if (refundAmount === originalStake) {
    // Perfect completion - full refund, celebrate!
    message = `🎉 PERFECT! You crushed it!\n\nFull $${refundAmount} refunded to your card (5-10 business days).\n\nView your stats: cheengu.com/dashboard\n\nReady for another challenge? Text START!`;
  } else if (refundAmount > 0) {
    // Partial completion - show what they kept
    const percentKept = Math.round((refundAmount / originalStake) * 100);
    const daysLost = Math.round(totalPenalties / (user.penalty_per_failure || 5));
    message = `✅ Commitment complete!\n\nYou kept ${percentKept}% of your stake.\n$${refundAmount}/$${originalStake} refunded (5-10 business days).\n\n${daysLost} missed day${daysLost > 1 ? 's' : ''} cost you $${totalPenalties}.\n\nView history: cheengu.com/dashboard\n\nText START to go again!`;
  } else {
    // No refund
    message = `😔 Commitment complete.\n\nYour full stake was lost through missed days.\n\nView history: cheengu.com/dashboard\n\nDon't give up - text START to try again! 💪`;
  }

  await sendSMS(user.phone, message);
  
  // Notify judge that commitment ended
  const judgeName = user.judge_name || 'Judge';
  await sendSMS(
    user.judge_phone,
    `${userName}'s commitment has ended. Thanks for being their accountability partner! 🙏`
  );
}

module.exports = { handleFailure, endCommitment };