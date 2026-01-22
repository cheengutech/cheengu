// ============================================================================
// FILE: src/handlers/daily.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone, isValidYesNo } = require('../utils/phone');
const { handleFailure } = require('../services/commitment');

async function handleUserClaim(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .eq('status', 'active')
    .single();

  if (!user) return false;

  const today = new Date().toISOString().split('T')[0];
  
  const { data: log } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .eq('outcome', 'pending')
    .single();

  if (!log) return false;

  if (!isValidYesNo(message)) {
    await sendSMS(normalizedPhone, 'Reply YES or NO only.');
    return true;
  }

  const claimed = message.toUpperCase() === 'YES';

  if (!claimed) {
    // User said NO - immediate failure
    await handleFailure(user, log);
    return true;
  }

  // User said YES - send to judge
  await supabase
    .from('daily_logs')
    .update({ user_claimed: true })
    .eq('id', log.id);

  await sendSMS(
    user.judge_phone,
    `${normalizedPhone} says they completed today's commitment.\n\nReply YES if true or NO if not.`
  );

  return true;
}

module.exports = { handleUserClaim };