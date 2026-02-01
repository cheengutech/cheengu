// src/handlers/menu.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');

/**
 * Handle when judge texts "MENU"
 */
async function handleMenuCommand(judgePhone) {
  console.log(`📋 Menu command from ${judgePhone}`);

  // Get all active users this judge is judging
  const { data: judges, error: judgeError } = await supabase
    .from('judges')
    .select('*, users(*)')
    .eq('phone', judgePhone)
    .eq('consent_status', 'accepted');

  if (judgeError) {
    console.error('Error fetching judges:', judgeError);
    await sendSMS(judgePhone, "Error loading menu. Please try again.");
    return;
  }

  if (!judges || judges.length === 0) {
    await sendSMS(judgePhone, "You're not currently judging any commitments.");
    return;
  }

  // Get today's date (using timezone from first user)
  const { getTodayDate } = require('../utils/timezone');
  const timezone = judges[0].users.timezone || 'America/Los_Angeles';
  const today = getTodayDate(timezone);

  // Find pending verifications for today
  const pendingVerifications = [];
  
  for (const judge of judges) {
    const user = judge.users;
    
    // Check if user is active
    if (user.status !== 'active') continue;

    // Check if there's a daily log for today that's pending
    const { data: log } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .eq('outcome', 'pending')
      .single();

    // Only include if log exists and pending
    if (log) {
      const userName = user.phone.slice(-4); // Last 4 digits as identifier
      
      pendingVerifications.push({
        logId: log.id,
        userId: user.id,
        userPhone: user.phone,
        userName: userName,
        commitmentText: user.commitment_text,
        commitmentType: user.commitment_type,
        userClaimed: log.user_claimed
      });
    }
  }

  // If nothing pending
  if (pendingVerifications.length === 0) {
    await sendSMS(judgePhone, "No pending verifications today.\nAll caught up! ✓");
    return;
  }

  // Create menu session (expires in 1 hour)
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);

  const { data: session, error: sessionError } = await supabase
    .from('judge_menu_sessions')
    .insert({
      judge_phone: judgePhone,
      pending_verifications: pendingVerifications,
      active: true,
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single();

  if (sessionError) {
    console.error('Error creating menu session:', sessionError);
    await sendSMS(judgePhone, "Error creating menu. Please try again.");
    return;
  }

  // Build menu message
  let menuMessage = '';
  
  if (pendingVerifications.length === 1) {
    const item = pendingVerifications[0];
    
    menuMessage = `📋 MENU - ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}\n\n`;
    menuMessage += `User ${item.userName}\n`;
    menuMessage += `${item.commitmentText}\n\n`;
    menuMessage += `Reply:\n`;
    menuMessage += `1 - Completed ✓\n`;
    menuMessage += `2 - Failed ✗`;
  } else {
    menuMessage = `📋 MENU - Pending verifications:\n\n`;
    
    pendingVerifications.forEach((item, index) => {
      const optionNum = (index * 2) + 1;
      menuMessage += `User ${item.userName} - ${item.commitmentText}\n`;
      menuMessage += `${optionNum} - Completed ✓\n`;
      menuMessage += `${optionNum + 1} - Failed ✗\n\n`;
    });
    
    menuMessage += `Reply with number`;
  }

  await sendSMS(judgePhone, menuMessage);
}

/**
 * Handle judge's numbered response to menu
 * Returns true if this was a menu response, false otherwise
 */
async function handleMenuResponse(judgePhone, message) {
  // Check if judge has an active menu session
  const { data: session } = await supabase
    .from('judge_menu_sessions')
    .select('*')
    .eq('judge_phone', judgePhone)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    return false; // Not a menu response
  }

  console.log(`📋 Menu response from ${judgePhone}: ${message}`);

  const choice = parseInt(message.trim());
  
  if (isNaN(choice)) {
    await sendSMS(judgePhone, "Invalid choice. Reply with a number or text MENU again.");
    return true; // Was a menu response, just invalid
  }

  const pendingVerifications = session.pending_verifications;

  // Determine which verification and action
  let verification;
  let isSuccess;

  if (pendingVerifications.length === 1) {
    verification = pendingVerifications[0];
    if (choice === 1) {
      isSuccess = true;
    } else if (choice === 2) {
      isSuccess = false;
    } else {
      await sendSMS(judgePhone, "Invalid choice. Reply 1 or 2.");
      return true;
    }
  } else {
    // Multiple verifications - odd numbers are completed, even are failed
    const verificationIndex = Math.floor((choice - 1) / 2);
    verification = pendingVerifications[verificationIndex];
    
    if (!verification) {
      await sendSMS(judgePhone, "Invalid choice. Text MENU to see options again.");
      return true;
    }
    
    isSuccess = (choice % 2 === 1);
  }

  // Update daily_log with judge's response
  const { error: updateError } = await supabase
    .from('daily_logs')
    .update({
      judge_verified: true,
      outcome: isSuccess ? 'pass' : 'fail'
    })
    .eq('id', verification.logId);

  if (updateError) {
    console.error('Error updating daily log:', updateError);
    await sendSMS(judgePhone, "Error processing verification. Please try again.");
    return true;
  }

  // Deactivate menu session
  await supabase
    .from('judge_menu_sessions')
    .update({ active: false })
    .eq('id', session.id);

  // If failed, trigger penalty logic
  if (!isSuccess) {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', verification.userId)
      .single();

    const { data: log } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('id', verification.logId)
      .single();

    if (user && log) {
      const { handleFailure } = require('../services/commitment');
      await handleFailure(user, log);
    }
  } else {
    // Success - just confirm
    await sendSMS(verification.userPhone, `✓ Day marked as PASS.\n${verification.commitmentText}`);
  }

  // Confirm to judge
  const actionText = isSuccess ? 'completed' : 'failed';
  const emoji = isSuccess ? '✓' : '✗';
  const confirmMessage = `${emoji} Marked User ${verification.userName} as ${actionText}\n${verification.commitmentText}\n${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  
  await sendSMS(judgePhone, confirmMessage);

  return true; // Was a menu response
}

module.exports = {
  handleMenuCommand,
  handleMenuResponse
};