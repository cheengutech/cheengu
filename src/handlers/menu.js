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

  // Find all users with active commitments for today
  const availableVerifications = [];
  
  for (const judge of judges) {
    const user = judge.users;
    
    // Check if user is active and commitment is DAILY type
    if (user.status !== 'active') continue;
    if (user.commitment_type !== 'daily') continue; // Only daily commitments for now

    // Check if there's already a log for today
    const { data: existingLog } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    // If log exists and already verified, skip
    if (existingLog && existingLog.outcome !== 'pending') continue;

    const userName = user.user_name || user.phone.slice(-4); // Use name if available, else last 4 digits
    
    availableVerifications.push({
      logId: existingLog?.id || null, // May not exist yet
      userId: user.id,
      userPhone: user.phone,
      userName: userName,
      commitmentText: user.commitment_text,
      commitmentType: user.commitment_type,
      hasExistingLog: !!existingLog
    });
  }

  // If nothing available
  if (availableVerifications.length === 0) {
    await sendSMS(judgePhone, "No active commitments for today.\nAll caught up! ✓");
    return;
  }

  // Create menu session (expires in 1 hour)
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);

  // Deactivate any existing sessions first
  await supabase
    .from('judge_menu_sessions')
    .update({ active: false })
    .eq('judge_phone', judgePhone);

  const { data: session, error: sessionError } = await supabase
    .from('judge_menu_sessions')
    .insert({
      judge_phone: judgePhone,
      pending_verifications: availableVerifications,
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
  
  if (availableVerifications.length === 1) {
    const item = availableVerifications[0];
    
    menuMessage = `📋 MENU - ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}\n\n`;
    menuMessage += `${item.userName}\n`;
    menuMessage += `"${item.commitmentText}"\n\n`;
    menuMessage += `Reply:\n`;
    menuMessage += `1 - Completed ✓\n`;
    menuMessage += `2 - Failed ✗`;
  } else {
    menuMessage = `📋 MENU - Active commitments today:\n\n`;
    
    availableVerifications.forEach((item, index) => {
      const optionNum = (index * 2) + 1;
      menuMessage += `${item.userName} - "${item.commitmentText}"\n`;
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
  // Ignore command keywords - let them pass through to other handlers
  const upperMessage = message.trim().toUpperCase();
  const commands = ['START', 'INFO', 'STATUS', 'HISTORY', 'RESET', 'MENU', 'YES', 'NO'];
  if (commands.includes(upperMessage)) {
    return false; // Not a menu response, let other handlers deal with it
  }

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
    await sendSMS(judgePhone, "Invalid choice. Reply with a number (1 or 2) or text MENU again.");
    return true; // Was a menu response, just invalid
  }

  const availableVerifications = session.pending_verifications;

  // Determine which verification and action
  let verification;
  let isSuccess;

  if (availableVerifications.length === 1) {
    verification = availableVerifications[0];
    if (choice === 1) {
      isSuccess = true;
    } else if (choice === 2) {
      isSuccess = false;
    } else {
      await sendSMS(judgePhone, "Invalid choice. Reply 1 for completed or 2 for failed.");
      return true;
    }
  } else {
    // Multiple verifications - odd numbers are completed, even are failed
    const verificationIndex = Math.floor((choice - 1) / 2);
    verification = availableVerifications[verificationIndex];
    
    if (!verification) {
      await sendSMS(judgePhone, "Invalid choice. Text MENU to see options again.");
      return true;
    }
    
    isSuccess = (choice % 2 === 1);
  }

  // Get today's date
  const { getTodayDate } = require('../utils/timezone');
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', verification.userId)
    .single();

  const today = getTodayDate(user.timezone);

  // Create or update daily_log
  let logId = verification.logId;

  if (!verification.hasExistingLog) {
    // Create new log entry for early check-in
    const { data: newLog, error: createError } = await supabase
      .from('daily_logs')
      .insert({
        user_id: verification.userId,
        date: today,
        outcome: isSuccess ? 'pass' : 'fail',
        judge_verified: true,
        user_claimed: null // Judge marked it directly
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating daily log:', createError);
      await sendSMS(judgePhone, "Error processing verification. Please try again.");
      return true;
    }

    logId = newLog.id;
  } else {
    // Update existing log
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
  }

  // Deactivate menu session
  await supabase
    .from('judge_menu_sessions')
    .update({ active: false })
    .eq('id', session.id);

  // If failed, trigger penalty logic
  if (!isSuccess) {
    const { data: log } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('id', logId)
      .single();

    if (user && log) {
      const { handleFailure } = require('../services/commitment');
      await handleFailure(user, log);
    }
  } else {
    // Success - just confirm
    const userName = user.user_name || 'Your commitment';
    await sendSMS(verification.userPhone, `✅ Day verified by your judge!\n\n"${verification.commitmentText}"\n\nKeep it up! 💪`);
  }

  // Confirm to judge
  const actionText = isSuccess ? 'completed' : 'failed';
  const emoji = isSuccess ? '✅' : '❌';
  const confirmMessage = `${emoji} Marked ${verification.userName} as ${actionText}.\n\n"${verification.commitmentText}"`;
  
  await sendSMS(judgePhone, confirmMessage);

  return true; // Was a menu response
}

module.exports = {
  handleMenuCommand,
  handleMenuResponse
};