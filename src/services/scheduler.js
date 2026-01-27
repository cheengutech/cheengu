// src/services/scheduler.js

const cron = require('node-cron');
const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');
const { getUserHour, getTodayDate } = require('../utils/timezone');
const { handleFailure, endCommitment } = require('./commitment');

async function sendDailyCheckIn(userId, userPhone, judgePhone, commitmentText, timezone) {
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

  // Ask judge directly
  console.log(`📤 Sending check-in to judge: ${judgePhone}`);
  await sendSMS(
    judgePhone, 
    `Did ${userPhone} complete today's commitment (${commitmentText})?\n\nReply YES or NO.`
  );
}

async function sendDeadlineCheckIn(userId, userPhone, judgePhone, commitmentText, deadlineDate) {
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

  // Ask judge about final outcome
  await sendSMS(
    judgePhone,
    `Did ${userPhone} complete their commitment (${commitmentText}) by the deadline?\n\nReply YES or NO.`
  );
}

function startDailyCronJobs() {
  console.log('⏰ Starting cron jobs...');

  // Run every minute to check for daily commitments at 8pm
  cron.schedule('* * * * *', async () => {
    try {
      const { data: activeUsers } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active');

      for (const user of activeUsers || []) {
        // Handle DAILY commitments
        if (user.commitment_type === 'daily') {
          const userHour = getUserHour(user.timezone);
          
          if (userHour === 20) { // 8pm
            await sendDailyCheckIn(
              user.id, 
              user.phone, 
              user.judge_phone,
              user.commitment_text,
              user.timezone
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
              user.deadline_date
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

  // 10pm - handle no-response from users for DAILY (treat as NO)
  // Note: DEADLINE commitments don't have daily check-ins, so this doesn't apply
  cron.schedule('0 22 * * *', async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('date', today)
        .eq('outcome', 'pending')
        .is('user_claimed', null);

      for (const log of pendingLogs || []) {
        // Only for daily commitments
        if (log.users.commitment_type === 'daily') {
          await handleFailure(log.users, log);
        }
      }
    } catch (error) {
      console.error('Error in 10pm cron job:', error);
    }
  });

  // 11pm - handle no-response from judges (default to PASS)
  cron.schedule('0 23 * * *', async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('date', today)
        .eq('outcome', 'pending')
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        await supabase
          .from('daily_logs')
          .update({
            judge_verified: true,
            outcome: 'pass'
          })
          .eq('id', log.id);

        if (log.users.commitment_type === 'daily') {
          await sendSMS(log.users.phone, 'Judge did not respond. Day marked as PASS.');
        } else {
          // Deadline - no response = PASS (benefit of doubt)
          await sendSMS(log.users.phone, 'Judge did not respond. Commitment marked as PASS.');
        }
      }
    } catch (error) {
      console.error('Error in 11pm cron job:', error);
    }
  });

  console.log('✅ Cron jobs started');
}

module.exports = { startDailyCronJobs, sendDailyCheckIn, sendDeadlineCheckIn };