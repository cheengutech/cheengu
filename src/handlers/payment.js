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
  const userName = metadata.user_name || setupState.temp_user_name || null;
  const judgeName = metadata.judge_name || setupState.temp_judge_name || null;

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

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      phone: normalizedPhone,
      user_name: userName,
      commitment_text: setupState.temp_commitment,
      commitment_type: setupState.temp_commitment_type || 'daily',
      deadline_date: setupState.temp_commitment_type === 'deadline' ? setupState.temp_deadline_date : null,
      judge_phone: setupState.temp_judge_phone,
      judge_name: judgeName,
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

  if (userError) {
    console.error('❌ Error creating user:', userError);
    return;
  }

  if (!user) {
    console.error('❌ User insert returned null');
    return;
  }

  console.log('✅ User created:', user.id);

  // Create judge entry
  await supabase.from('judges').insert({
    phone: setupState.temp_judge_phone,
    user_id: user.id,
    consent_status: 'pending'
  });

  // Send judge consent request with clear explanation
  const displayName = userName || normalizedPhone;
  let judgeMessage;
  if (user.commitment_type === 'daily') {
    const days = Math.ceil((new Date(user.commitment_end_date) - new Date(user.commitment_start_date)) / (1000 * 60 * 60 * 24));
    judgeMessage = `${displayName} wants you to be their accountability judge!\n\nCommitment: "${user.commitment_text}"\n\nYou'll verify DAILY at 8pm for ${days} days.\n\nReply ACCEPT or DECLINE.`;
  } else {
    judgeMessage = `${displayName} wants you to be their accountability judge!\n\nCommitment: "${user.commitment_text}"\n\nYou'll verify ONCE on ${user.deadline_date}.\n\nReply ACCEPT or DECLINE.`;
  }
    
  await sendSMS(setupState.temp_judge_phone, judgeMessage);

  // Clean up setup state
  await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
}

module.exports = { finalizeSetup };