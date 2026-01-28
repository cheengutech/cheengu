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

  // 10pm - send FIRST reminder to judges who haven't responded (2 hours after initial)
  cron.schedule('0 22 * * *', async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('date', today)
        .eq('outcome', 'pending')
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        await sendSMS(
          log.users.judge_phone,
          `Reminder: Did ${log.users.phone} complete today's commitment?\n\nReply YES or NO.`
        );
        console.log(`⏰ Sent 1st reminder to judge: ${log.users.judge_phone}`);
      }
    } catch (error) {
      console.error('Error in 10pm reminder job:', error);
    }
  });

  // 12am (midnight) - send SECOND reminder to judges who still haven't responded
  cron.schedule('0 0 * * *', async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0];
      
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('date', yesterdayDate)
        .eq('outcome', 'pending')
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        await sendSMS(
          log.users.judge_phone,
          `Final reminder: Did ${log.users.phone} complete yesterday's commitment?\n\nReply YES or NO. Auto-PASS in 2 hours if no response.`
        );
        console.log(`⏰ Sent 2nd reminder to judge: ${log.users.judge_phone}`);
      }
    } catch (error) {
      console.error('Error in midnight reminder job:', error);
    }
  });

  // 2am - handle no-response from judges after TWO reminders (default to PASS)
  cron.schedule('0 2 * * *', async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0];
      
      const { data: pendingLogs } = await supabase
        .from('daily_logs')
        .select('*, users(*)')
        .eq('date', yesterdayDate)
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
          await sendSMS(log.users.phone, 'Judge did not respond after 2 reminders. Day marked as PASS.');
        } else {
          await sendSMS(log.users.phone, 'Judge did not respond after 2 reminders. Commitment marked as PASS.');
        }
        
        console.log(`✅ Auto-PASS after 2 reminders (no judge response): ${log.users.phone}`);
      }
    } catch (error) {
      console.error('Error in 2am auto-pass job:', error);
    }
  });

  console.log('✅ Cron jobs started');
}

module.exports = { startDailyCronJobs, sendDailyCheckIn, sendDeadlineCheckIn };