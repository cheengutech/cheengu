// src/handlers/judge.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { handleFailure } = require('../services/commitment');
const { getTodayDate } = require('../utils/timezone');
const { interpretInput, needsInterpretation } = require('../services/interpreter');

// Store recent verifications for UNDO (phone -> { logId, outcome, userId, timestamp })
const recentVerifications = new Map();
const UNDO_WINDOW = 5 * 60 * 1000; // 5 minutes

function normalizePhone(phone) {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  // Add +1 if it's a 10-digit US number
  if (digits.length === 10) {
    return '+1' + digits;
  }
  // Add + if missing
  if (!phone.startsWith('+')) {
    return '+' + digits;
  }
  return phone;
}

function isValidYesNo(message) {
  const normalized = message.trim().toUpperCase();
  return normalized === 'YES' || normalized === 'NO';
}

async function handleJudgeResponse(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  // Don't use .single() - there might be multiple judge records for this phone
  const { data: judges } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', normalizedPhone)
    .eq('consent_status', 'pending');

  // Get the first pending one (most recent)
  const judge = judges && judges.length > 0 ? judges[0] : null;

  if (!judge) return false;

  const upperMessage = message.trim().toUpperCase();

  // Case-insensitive check with trim
  if (upperMessage === 'ACCEPT') {
    await supabase
      .from('judges')
      .update({ consent_status: 'accepted' })
      .eq('id', judge.id);

    await supabase
      .from('users')
      .update({ status: 'active' })
      .eq('id', judge.user_id);

    // Use name if available
    const userName = judge.users.user_name || 'Your friend';
    const typeText = judge.users.commitment_type === 'daily' 
      ? 'You\'ll get daily check-in requests at 8pm.'
      : `You\'ll get one check-in on ${judge.users.deadline_date}.`;
      
    await sendSMS(normalizedPhone, `You're now ${userName}'s accountability judge! ${typeText}`);
    await sendSMS(judge.users.phone, 'Your judge accepted! Your commitment starts now. 💪\n\nTrack progress: cheengu.com/dashboard\n\nText HOW for help.');
    return true;
  }

  if (upperMessage === 'DECLINE') {
    await supabase
      .from('judges')
      .update({ consent_status: 'declined' })
      .eq('id', judge.id);

    await supabase
      .from('users')
      .update({ status: 'judge_declined' })
      .eq('id', judge.user_id);

    // TODO: Refund user's stake since judge declined
      
    await sendSMS(normalizedPhone, 'No problem. Thanks for letting us know.');
    await sendSMS(judge.users.phone, 'Your judge declined. Your stake will be refunded. Text START to try again with a different judge.');
    return true;
  }

  return false;
}

async function handleJudgeUndo(phone) {
  const normalizedPhone = normalizePhone(phone);
  
  const recent = recentVerifications.get(normalizedPhone);
  
  if (!recent) {
    await sendSMS(normalizedPhone, "Nothing to undo. You haven't verified anyone recently.");
    return true;
  }
  
  // Check if within undo window
  if (Date.now() - recent.timestamp > UNDO_WINDOW) {
    recentVerifications.delete(normalizedPhone);
    await sendSMS(normalizedPhone, "Too late to undo - the 5 minute window has passed.");
    return true;
  }
  
  // Get user info for messaging
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', recent.userId)
    .single();
  
  if (!user) {
    await sendSMS(normalizedPhone, "Error: Could not find the commitment to undo.");
    return true;
  }
  
  const userName = user.user_name || user.phone.slice(-4);
  
  // If it was a FAIL, we need to restore the stake
  if (recent.outcome === 'fail') {
    const penaltyAmount = user.penalty_per_failure || 5;
    await supabase
      .from('users')
      .update({ stake_remaining: parseFloat(user.stake_remaining) + penaltyAmount })
      .eq('id', user.id);
  }
  
  // Reset the log to pending
  await supabase
    .from('daily_logs')
    .update({
      judge_verified: null,
      outcome: 'pending'
    })
    .eq('id', recent.logId);
  
  // Clear the undo record
  recentVerifications.delete(normalizedPhone);
  
  // Notify and ask again
  await sendSMS(normalizedPhone, `Undone! Did ${userName} complete today's commitment?\n\n"${user.commitment_text}"\n\nReply YES or NO.`);
  await sendSMS(user.phone, "Your judge is re-verifying today's check-in.");
  
  return true;
}

async function handleJudgeVerification(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  const upperMessage = message.trim().toUpperCase();
  
  // Check for UNDO command
  if (upperMessage === 'UNDO') {
    return await handleJudgeUndo(phone);
  }
  
  console.log('🔍 Checking if judge verification:', normalizedPhone, message);
  
  // Don't use .single() - there might be multiple judge records for this phone
  const { data: judges } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', normalizedPhone)
    .eq('consent_status', 'accepted');

  console.log('👨‍⚖️ Judge lookup result:', judges);

  if (!judges || judges.length === 0) {
    console.log('❌ Not a judge or not accepted');
    return false;
  }

  // Check each user this person is judging for pending logs
  for (const judge of judges) {
    const today = getTodayDate(judge.users.timezone);
    
    console.log('📅 Looking for pending log on date:', today, 'for user:', judge.user_id);
    
    const { data: log } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', judge.user_id)
      .eq('date', today)
      .eq('outcome', 'pending')
      .single();

    console.log('📋 Log lookup result:', log);

    if (!log) {
      console.log('❌ No pending log found for this user today');
      continue; // Check next user they're judging
    }

    if (!isValidYesNo(message)) {
      // Try AI interpreter for things like "yep", "he did it", "nope didn't happen"
      if (needsInterpretation(message, 'judge_verification')) {
        console.log('🤖 Trying AI interpreter for judge verification...');
        const aiResult = await interpretInput(message, 'judge_verification');
        
        if (aiResult.success) {
          message = aiResult.value; // Will be "YES" or "NO"
          console.log('🤖 AI parsed verification:', message);
        } else {
          await sendSMS(normalizedPhone, aiResult.clarification || 'Reply YES or NO only.');
          return true;
        }
      } else {
        console.log('⚠️ Invalid response, must be YES or NO');
        await sendSMS(normalizedPhone, 'Reply YES or NO only.');
        return true;
      }
    }

    const verified = message.trim().toUpperCase() === 'YES';
    console.log('✅ Judge verified:', verified);

    const userName = judge.users.user_name || judge.users.phone.slice(-4);

    if (verified) {
      // PASS
      await supabase
        .from('daily_logs')
        .update({
          judge_verified: true,
          outcome: 'pass'
        })
        .eq('id', log.id);

      // Store for potential UNDO
      recentVerifications.set(normalizedPhone, {
        logId: log.id,
        outcome: 'pass',
        userId: judge.user_id,
        timestamp: Date.now()
      });

      await sendSMS(judge.users.phone, '✅ Day verified by your judge! Keep it up! 💪');
      await sendSMS(normalizedPhone, `✅ Marked ${userName} as PASS for today.\n\nMade a mistake? Reply UNDO in the next 5 minutes.`);
    } else {
      // FAIL
      if (judge.users.commitment_type === 'deadline') {
        // All-or-nothing for deadline
        await handleDeadlineFailure(judge.users);
      } else {
        // Gradual for daily
        await handleFailure(judge.users, log);
      }
      
      // Store for potential UNDO
      recentVerifications.set(normalizedPhone, {
        logId: log.id,
        outcome: 'fail',
        userId: judge.user_id,
        timestamp: Date.now()
      });
      
      await sendSMS(normalizedPhone, `❌ Marked ${userName} as FAIL for today.\n\nMade a mistake? Reply UNDO in the next 5 minutes.`);
    }

    return true;
  }

  // No pending logs found for any user this judge is responsible for
  console.log('❌ No pending logs found for today');
  return false;
}

async function handleDeadlineFailure(user) {
  // All-or-nothing: lose entire stake
  const lostAmount = user.stake_remaining;
  
  await supabase
    .from('users')
    .update({ 
      stake_remaining: 0,
      status: 'completed',
      refund_status: 'no_refund',
      refund_amount: 0
    })
    .eq('id', user.id);

  // Record the failure in daily_logs
  await supabase
    .from('daily_logs')
    .update({
      judge_verified: true,
      outcome: 'fail'
    })
    .eq('user_id', user.id)
    .eq('outcome', 'pending');

  const userName = user.user_name || 'You';
  await sendSMS(user.phone, `❌ Commitment FAILED. You lost your entire stake: $${lostAmount}`);
  await sendSMS(user.judge_phone, `${userName}'s commitment is complete. They missed the deadline.`);
}

module.exports = { handleJudgeResponse, handleJudgeVerification };