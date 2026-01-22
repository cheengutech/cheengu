// src/services/scheduler.js

const cron = require('node-cron');
const { supabase } = require('../config/database');
const { sendSMS } = require('./sms');
const { getUserHour, getTodayDate } = require('../utils/timezone');
const { handleFailure, endCommitment } = require('./commitment');

async function sendDailyClaim(userId, userPhone, timezone) {
  const today = getTodayDate(timezone);
  
  const { data: existing } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (existing) return;

  await supabase.from('daily_logs').insert({
    user_id: userId,
    date: today,
    outcome: 'pending'
  });

  await sendSMS(userPhone, 'Did you complete today\'s commitment?\n\nReply YES or NO.');
}

function startDailyCronJobs() {
  console.log('⏰ Starting cron jobs...');

  // Run every minute to check for 8pm in user timezones
  cron.schedule('* * * * *', async () => {
    try {
      const { data: activeUsers } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active');

      for (const user of activeUsers || []) {
        const userHour = getUserHour(user.timezone);
        
        if (userHour === 20) { // 8pm
          await sendDailyClaim(user.id, user.phone, user.timezone);
        }

        // Check if commitment ended
        const endDate = new Date(user.commitment_end_date);
        if (new Date() >= endDate) {
          await endCommitment(user.id, 'time_completed');
        }
      }
    } catch (error) {
      console.error('Error in 8pm cron job:', error);
    }
  });

  // 10pm - handle no-response from users (treat as NO)
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
        await handleFailure(log.users, log);
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
        .eq('user_claimed', true)
        .is('judge_verified', null);

      for (const log of pendingLogs || []) {
        await supabase
          .from('daily_logs')
          .update({
            judge_verified: true,
            outcome: 'pass'
          })
          .eq('id', log.id);

        await sendSMS(log.users.phone, 'Judge did not respond. Day marked as PASS.');
      }
    } catch (error) {
      console.error('Error in 11pm cron job:', error);
    }
  });

  console.log('✅ Cron jobs started');
}

module.exports = { startDailyCronJobs, sendDailyClaim };