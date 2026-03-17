// src/services/scheduler.js

const cron = require('node-cron');
const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');
const { getUserHour, getTodayDate } = require('../utils/timezone');
const { handleFailure, endCommitment } = require('./commitment');

async function sendDailyCheckIn(userId, userPhone, judgePhone, commitmentText, timezone, userName) {
  const today = getTodayDate(timezone);
  
  console.log(`🔍 Checking for existing log for user ${userId} on ${today}`);
  
  const { data: existing, error: checkError } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (checkError && checkError.code !== 'PGRST116') {
    console.error('❌ Error checking existing log:', checkError);
  }

  if (existing) {
    console.log(`⚠️ Log already exists for ${today}, skipping`);
    return;
  }

  // Get user data for day counting and stake info
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) {
    console.error('❌ User not found:', userId);
    return;
  }

  // Calculate which day they're on
  const startDate = new Date(user.commitment_start_date);
  const todayDate = new Date(today);
  const dayNumber = Math.floor((todayDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
  const totalDays = Math.ceil((new Date(user.commitment_end_date) - startDate) / (1000 * 60 * 60 * 24));

  console.log(`📝 Creating new daily log for ${today}`);
  
  const { data: newLog, error: insertError } = await supabase
    .from('daily_logs')
    .insert({
      user_id: userId,
      date: today,
      outcome: 'pending'
    })
    .select()
    .single();

  if (insertError) {
    console.error('❌ Failed to create daily log:', insertError);
    return;
  }

  console.log(`✅ Daily log created:`, newLog);

  // Use name if available, otherwise last 4 digits of phone
  const displayName = userName || userPhone.slice(-4);

  // Build stake visual (e.g., 🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜ $17/$20)
  const stakePercent = Math.round((user.stake_remaining / user.original_stake) * 10);
  const stakeBar = '🟩'.repeat(stakePercent) + '⬜'.repeat(10 - stakePercent);

  // Send reminder to user with day counter and stake visual
  console.log(`📤 Sending reminder to user: ${userPhone}`);
  await sendSMS(
    userPhone,
    `Day ${dayNumber}/${totalDays}.\n\n"${commitmentText}"\n\n${stakeBar} $${user.stake_remaining}/$${user.original_stake}\n\nYour judge is being asked now. Don't let them down.`
  );

  // Ask judge to verify
  console.log(`📤 Sending check-in to judge: ${judgePhone}`);
  await sendSMS(
    judgePhone, 
    `Did ${displayName} complete today's commitment?\n\n"${commitmentText}"\n\nReply YES or NO.`
  );
}

async function sendDeadlineCheckIn(userId, userPhone, judgePhone, commitmentText, deadlineDate, userName) {
  console.log(`📅 Sending deadline check-in for ${userId}`);
  
  const { data: newLog, error: insertError } = await supabase
    .from('daily_logs')
    .insert({
      user_id: userId,
      date: deadlineDate,
      outcome: 'pending'
    })
    .select()
    .single();

  if (insertError) {
    console.error('❌ Failed to create deadline log:', insertError);
    return;
  }

  console.log(`✅ Deadline log created:`, newLog);

  // Use name if available, otherwise last 4 digits of phone
  const displayName = userName || userPhone.slice(-4);

  // Send reminder to user
  await sendSMS(
    userPhone,
    `D-DAY.\n\n"${commitmentText}"\n\nYour judge decides your fate now.`
  );

  // Ask judge about final outcome
  await sendSMS(
    judgePhone,
    `Did ${displayName} complete their commitment by the deadline?\n\n"${commitmentText}"\n\nReply YES or NO.`
  );
}

function startDailyCronJobs() {
  console.log('⏰ Starting cron jobs...');

  // Run at the top of every hour to check for daily commitments at 8pm in user's timezone
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Hourly check-in job running...');
    try {
      const { data: activeUsers } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active');

      for (const user of activeUsers || []) {
        // Handle DAILY commitments
        if (user.commitment_type === 'daily') {
          const userHour = getUserHour(user.timezone);
          
          if (userHour === 21) { // 9pm in user's timezone
            await sendDailyCheckIn(
              user.id, 
              user.phone, 
              user.judge_phone,
              user.commitment_text,
              user.timezone,
              user.user_name
            );
          }
        }
        
        // Handle DEADLINE commitments
        if (user.commitment_type === 'deadline') {
          const today = getTodayDate(user.timezone);
          const userHour = getUserHour(user.timezone);
          
          // Check if today is deadline day and it's 8pm
          if (today === user.deadline_date && userHour === 20) {
            await sendDeadlineCheckIn(
              user.id,
              user.phone,
              user.judge_phone,
              user.commitment_text,
              user.deadline_date,
              user.user_name
            );
          }
        }

        // Check if commitment ended (for both types)
        const endDate = new Date(user.commitment_end_date);
        if (new Date() >= endDate) {
          await endCommitment(user.id, 'time_completed');
        }
      }
    } catch (error) {
      console.error('Error in main cron job:', error);
    }
  });

  // 11pm in user's timezone - send FIRST reminder to judges who haven't responded
  cron.schedule('0 * * * *', async () => {
    try {
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('outcome', 'pending')
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        const userHour = getUserHour(log.users.timezone);
        const today = getTodayDate(log.users.timezone);
        
        // Only send at 11pm and only for today's logs
        if (userHour === 23 && log.date === today) {
          const displayName = log.users.user_name || log.users.phone.slice(-4);
          await sendSMS(
            log.users.judge_phone,
            `Reminder: Did ${displayName} complete today's commitment?\n\n"${log.users.commitment_text}"\n\nReply YES or NO.`
          );
          console.log(`⏰ Sent 1st reminder to judge: ${log.users.judge_phone}`);
        }
      }
    } catch (error) {
      console.error('Error in 11pm reminder job:', error);
    }
  });

  // 7am next day in user's timezone - send SECOND reminder to judges who still haven't responded
  cron.schedule('0 * * * *', async () => {
    try {
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('outcome', 'pending')
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        const userHour = getUserHour(log.users.timezone);
        const today = getTodayDate(log.users.timezone);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = yesterday.toISOString().split('T')[0];
        
        // Only send at 7am for yesterday's logs
        if (userHour === 7 && log.date === yesterdayDate) {
          const displayName = log.users.user_name || log.users.phone.slice(-4);
          await sendSMS(
            log.users.judge_phone,
            `Final reminder: Did ${displayName} complete yesterday's commitment?\n\n"${log.users.commitment_text}"\n\nReply YES or NO. Auto-FAIL at noon if no response.`
          );
          console.log(`⏰ Sent 2nd reminder to judge: ${log.users.judge_phone}`);
        }
      }
    } catch (error) {
      console.error('Error in 7am reminder job:', error);
    }
  });

  // 12pm (noon) next day in user's timezone - handle no-response from judges (default to FAIL)
  cron.schedule('0 * * * *', async () => {
    try {
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('outcome', 'pending')
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        const userHour = getUserHour(log.users.timezone);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = yesterday.toISOString().split('T')[0];
        
        // Only auto-fail at noon for yesterday's logs
        if (userHour === 12 && log.date === yesterdayDate) {
          // Default to FAIL - user should have made sure their judge verified
          await handleFailure(log.users, log);
          
          const userName = log.users.user_name || log.users.phone.slice(-4);
          
          await sendSMS(log.users.phone, `Your judge went silent. Day marked FAIL.\n\nGet a judge who actually shows up, or that's on you.`);
          await sendSMS(log.users.judge_phone, `You didn't verify ${userName}. Marked as FAIL. Do better.`);
          
          console.log(`❌ Auto-FAIL after 2 reminders (no judge response): ${log.users.phone}`);
        }
      }
    } catch (error) {
      console.error('Error in noon auto-fail job:', error);
    }
  });

  // 9am in user's timezone - Morning reminder for DAILY commitments
  cron.schedule('0 * * * *', async () => {
    try {
      const { data: activeUsers } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active')
        .eq('commitment_type', 'daily');

      for (const user of activeUsers || []) {
        const userHour = getUserHour(user.timezone);
        
        if (userHour === 9) { // 9am in user's timezone
          await sendSMS(
            user.phone,
            `Rise and grind.\n\n"${user.commitment_text}"\n\nVerification at 2100. Don't make your judge wait.`
          );
          console.log(`🌅 Morning reminder sent to ${user.phone}`);
        }
      }
    } catch (error) {
      console.error('Error in morning reminder job:', error);
    }
  });

  // 10am in user's timezone - Weekly progress check for DEADLINE commitments
  cron.schedule('0 * * * *', async () => {
    try {
      const { data: deadlineUsers } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active')
        .eq('commitment_type', 'deadline');

      for (const user of deadlineUsers || []) {
        const userHour = getUserHour(user.timezone);
        const today = new Date();
        const deadline = new Date(user.deadline_date);
        const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        // Send progress check at 10am on Mondays, or when 7 days left, or when 3 days left
        const isMonday = today.getDay() === 1;
        const isSevenDaysOut = daysLeft === 7;
        const isThreeDaysOut = daysLeft === 3;
        const isOneDayOut = daysLeft === 1;
        
        if (userHour === 10 && (isMonday || isSevenDaysOut || isThreeDaysOut || isOneDayOut)) {
          const userName = user.user_name || 'there';
          let message;
          
          if (isOneDayOut) {
            message = `TOMORROW IS D-DAY.\n\n"${user.commitment_text}"\n\n$${user.stake_remaining} rides on it. No excuses.`;
          } else if (isThreeDaysOut) {
            message = `3 days. Clock's ticking.\n\n"${user.commitment_text}"\n\nFinish strong or pay up.`;
          } else if (isSevenDaysOut) {
            message = `One week left.\n\n"${user.commitment_text}"\n\n$${user.stake_remaining} on the line. Move.`;
          } else {
            message = `Weekly check: ${daysLeft} days remaining.\n\n"${user.commitment_text}"`;
          }
          
          await sendSMS(user.phone, message);
          console.log(`📅 Deadline nudge sent to ${user.phone} (${daysLeft} days left)`);
        }
      }
    } catch (error) {
      console.error('Error in deadline progress job:', error);
    }
  });

  // 10am user's timezone - Re-engagement for completed users (3 and 7 days after)
  cron.schedule('0 * * * *', async () => {
    try {
      const { data: completedUsers } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'completed');

      for (const user of completedUsers || []) {
        const userHour = getUserHour(user.timezone);
        if (userHour !== 10) continue; // Only at 10am
        
        // Check if they have an active commitment (might have re-enrolled)
        const { data: activeCheck } = await supabase
          .from('users')
          .select('id')
          .eq('phone', user.phone)
          .eq('status', 'active')
          .single();
        
        if (activeCheck) continue; // Already active, skip
        
        const endDate = new Date(user.commitment_end_date);
        const daysSinceEnd = Math.floor((new Date() - endDate) / (1000 * 60 * 60 * 24));
        
        // Only send on day 1, day 3 and day 7
        if (daysSinceEnd === 1) {
          await sendSMS(
            user.phone,
            `${user.user_name || 'Recruit'}. Your commitment ended yesterday. You gonna coast now, or are you ready for the next one?\n\nText START.`
          );
          console.log(`📣 Re-engagement (day 1) sent to ${user.phone}`);
        } else if (daysSinceEnd === 3) {
          await sendSMS(
            user.phone,
            `3 days since your last commitment. The longer you wait, the softer you get.\n\nText START.`
          );
          console.log(`📣 Re-engagement (day 3) sent to ${user.phone}`);
        } else if (daysSinceEnd === 7) {
          await sendSMS(
            user.phone,
            `One week. Radio silence ends here. Text START when you're ready to get back in the fight.`
          );
          console.log(`📣 Re-engagement (day 7 - final) sent to ${user.phone}`);
        }
      }
    } catch (error) {
      console.error('Error in re-engagement job:', error);
    }
  });

  // 9am PST (5pm UTC) - Daily refund report to admin
  const ADMIN_PHONE = '+15622768169';
  
  cron.schedule('0 17 * * *', async () => {
    console.log('📊 Running daily refund report...');
    try {
      const { data: pendingRefunds } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'completed')
        .gt('stake_remaining', 0)
        .or('refund_status.is.null,refund_status.eq.pending');
      
      if (!pendingRefunds || pendingRefunds.length === 0) {
        console.log('✅ No pending refunds');
        return;
      }
      
      let report = `💰 Refunds needed (${pendingRefunds.length}):\n\n`;
      
      for (const user of pendingRefunds) {
        const name = user.user_name || user.phone.slice(-4);
        const pi = user.payment_intent_id ? `...${user.payment_intent_id.slice(-8)}` : 'NO PI';
        report += `• ${name}: $${user.stake_remaining} (${pi})\n`;
      }
      
      report += `\nProcess in Stripe Dashboard.`;
      
      await sendSMS(ADMIN_PHONE, report);
      console.log('📤 Refund report sent to admin');
    } catch (error) {
      console.error('Error in refund report job:', error);
    }
  });

  console.log('✅ Cron jobs started');
}

module.exports = { startDailyCronJobs, sendDailyCheckIn, sendDeadlineCheckIn };