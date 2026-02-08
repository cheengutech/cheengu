// ============================================================================
// FILE: src/services/commitment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');
const { stripe } = require('../config/stripe');

async function handleFailure(user, log) {
  // Use the user's custom penalty amount, or default to $5
  const penaltyAmount = user.penalty_per_failure || 5;
  const newStake = parseFloat(user.stake_remaining) - penaltyAmount;
  
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

  await sendSMS(
    user.phone,
    `Day marked as FAIL. -$${penaltyAmount}. Stake remaining: $${Math.max(0, newStake)}`
  );
  
  // Don't tell judge they "earned" money since we're not paying them out yet
  await sendSMS(
    user.judge_phone,
    `Verified: ${user.phone} did not complete their commitment today.`
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
  
  if (reason === 'stake_depleted') {
    message = `Your stake has been fully depleted. Commitment ended. Keep going next time! 💪`;
  } else if (refundAmount === originalStake) {
    // Perfect completion - full refund
    message = `🎉 Congratulations! You completed your commitment with a perfect record!\n\nYour full $${refundAmount} stake is being refunded to your card (5-10 business days).`;
  } else if (refundAmount > 0) {
    // Partial completion
    message = `Your commitment is complete!\n\nYou missed ${Math.round(totalPenalties / (user.penalty_per_failure || 5))} day(s), so $${refundAmount} of your $${originalStake} stake is being refunded to your card (5-10 business days).`;
  } else {
    // No refund (stake depleted through this path shouldn't happen, but just in case)
    message = `Your commitment is complete. Your full stake was used up through missed days. Next time! 💪`;
  }

  await sendSMS(user.phone, message);
  
  // Notify judge that commitment ended
  await sendSMS(
    user.judge_phone,
    `${user.phone}'s commitment has ended. Thanks for being their accountability partner! 🙏`
  );
}

module.exports = { handleFailure, endCommitment };