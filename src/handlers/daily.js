// src/handlers/daily.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone, isValidYesNo } = require('../utils/phone');
const { handleFailure } = require('../services/commitment');

async function handleUserClaim(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  console.log('🎯 handleUserClaim called:', normalizedPhone, message);
  
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .eq('status', 'active')
    .single();

  if (!user) {
    console.log('❌ No active user found');
    return false;
  }

  console.log('✅ Active user found:', user.id);

  const today = new Date().toISOString().split('T')[0];
  
  const { data: log } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .eq('outcome', 'pending')
    .single();

  if (!log) {
    console.log('❌ No pending log for today');
    return false;
  }

  console.log('✅ Pending log found:', log.id);

  if (!isValidYesNo(message)) {
    console.log('⚠️ Invalid response, must be YES or NO');
    await sendSMS(normalizedPhone, 'Reply YES or NO only.');
    return true;
  }

  const claimed = message.toUpperCase() === 'YES';
  console.log('📝 User claimed:', claimed ? 'YES' : 'NO');

  if (!claimed) {
    // User said NO - immediate failure
    console.log('❌ User said NO - marking as failure');
    await handleFailure(user, log);
    return true;
  }

  // User said YES - send to judge for verification
  console.log('✅ User said YES - routing to judge for verification');
  
  const { error: updateError } = await supabase
    .from('daily_logs')
    .update({ user_claimed: true })
    .eq('id', log.id);

  if (updateError) {
    console.error('❌ Error updating log:', updateError);
  } else {
    console.log('✅ Log updated with user_claimed: true');
  }

  console.log('📤 Sending verification request to judge:', user.judge_phone);
  
  await sendSMS(
    user.judge_phone,
    `${normalizedPhone} says they completed today's commitment.\n\nReply YES if true or NO if not.`
  );

  console.log('✅ Verification request sent to judge');

  return true;
}

module.exports = { handleUserClaim };