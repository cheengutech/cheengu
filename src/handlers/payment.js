// ============================================================================
// FILE: src/handlers/payment.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');

async function finalizeSetup(phone, paymentIntent = null) {
  const normalizedPhone = normalizePhone(phone);
  
  const { data: setupState } = await supabase
    .from('setup_state')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  if (!setupState) return;

  // Get stake info from payment intent metadata, or fall back to setup state, or defaults
  const metadata = paymentIntent?.metadata || {};
  const stakeAmount = parseInt(metadata.stake_amount) || setupState.temp_stake_amount || 20;
  const penaltyAmount = parseInt(metadata.penalty_amount) || setupState.temp_penalty_amount || 5;

  // Calculate dates based on commitment type
  const startDate = new Date();
  let endDate;
  
  if (setupState.temp_commitment_type === 'deadline') {
    endDate = new Date(setupState.temp_deadline_date);
  } else {
    // Daily type - use the duration they specified
    const durationDays = parseInt(setupState.temp_deadline_date) || 7;
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);
  }

  const { data: user } = await supabase
    .from('users')
    .insert({
      phone: normalizedPhone,
      commitment_text: setupState.temp_commitment,
      commitment_type: setupState.temp_commitment_type || 'daily',
      deadline_date: setupState.temp_commitment_type === 'deadline' ? setupState.temp_deadline_date : null,
      judge_phone: setupState.temp_judge_phone,
      stake_remaining: stakeAmount,
      original_stake: stakeAmount,
      penalty_per_failure: penaltyAmount,
      payment_intent_id: paymentIntent?.id || null,
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

  // Send judge consent request with clear explanation
  let judgeMessage;
  if (user.commitment_type === 'daily') {
    const days = Math.ceil((new Date(user.commitment_end_date) - new Date(user.commitment_start_date)) / (1000 * 60 * 60 * 24));
    judgeMessage = `${normalizedPhone} wants you to be their accountability judge.\n\nCommitment: "${user.commitment_text}"\n\nYou'll verify DAILY at 8pm for ${days} days. Reply YES to accept (or ignore to decline).`;
  } else {
    judgeMessage = `${normalizedPhone} wants you to be their accountability judge.\n\nCommitment: "${user.commitment_text}"\n\nYou'll verify ONCE on ${user.deadline_date}. Reply YES to accept (or ignore to decline).`;
  }
    
  await sendSMS(setupState.temp_judge_phone, judgeMessage);

  // Clean up setup state
  await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
}

module.exports = { finalizeSetup };