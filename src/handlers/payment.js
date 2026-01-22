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

  // Create user
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);

  const { data: user } = await supabase
    .from('users')
    .insert({
      phone: normalizedPhone,
      commitment_text: setupState.temp_commitment,
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
  await sendSMS(
    setupState.temp_judge_phone,
    `${normalizedPhone} invited you to be their accountability judge for a fitness goal.\n\nReply YES to accept or ignore to decline.`
  );

  // Clean up setup state
  await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
}

module.exports = { finalizeSetup };
