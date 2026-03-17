// ============================================================================
// FILE: src/services/scheduler.js
// CHEENGU V2: Daily check-ins and challenge completion
// ============================================================================

const cron = require('node-cron');
const { supabase } = require('../config/database');
const { sendSMS, sendSMSWithAIGif } = require('./sms');
const { getStandings } = require('../handlers/checkin');

function startScheduler() {
  console.log('⏰ Starting Cheengu V2 scheduler...');

  // Run at the top of every hour to check for 9pm in user's timezone
  // For simplicity, we'll use a fixed 9pm PT check
  cron.schedule('0 21 * * *', async () => {
    console.log('📤 Running daily check-in job (9pm PT)...');
    await sendDailyCheckIns();
  }, {
    timezone: 'America/Los_Angeles'
  });

  // Mark no-responses at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ Running no-response cleanup...');
    await markNoResponses();
  }, {
    timezone: 'America/Los_Angeles'
  });

  // Check for completed challenges at 1am
  cron.schedule('0 1 * * *', async () => {
    console.log('🏁 Checking for completed challenges...');
    await checkCompletedChallenges();
  }, {
    timezone: 'America/Los_Angeles'
  });

  console.log('✅ Scheduler started');
}

async function sendDailyCheckIns() {
  // Get all active challenges
  const { data: challenges } = await supabase
    .from('challenges')
    .select('*')
    .eq('status', 'active');

  for (const challenge of challenges || []) {
    await sendChallengeCheckIn(challenge);
  }
}

async function sendChallengeCheckIn(challenge) {
  const today = new Date().toISOString().split('T')[0];
  
  // Calculate day number
  const startDate = new Date(challenge.start_date);
  const todayDate = new Date(today);
  const dayNum = Math.floor((todayDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  // Check if we're past the end date
  if (dayNum > challenge.duration_days) {
    return; // Challenge should be completed
  }

  // Get participants
  const { data: participants } = await supabase
    .from('participants')
    .select('*')
    .eq('challenge_id', challenge.id)
    .eq('status', 'accepted')
    .order('score', { ascending: false });

  if (!participants || participants.length === 0) {
    return;
  }

  // Create check-in records for today
  for (const p of participants) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('check_ins')
      .select('*')
      .eq('participant_id', p.id)
      .eq('date', today)
      .single();

    if (!existing) {
      await supabase
        .from('check_ins')
        .insert({
          challenge_id: challenge.id,
          participant_id: p.id,
          day_number: dayNum,
          date: today
        });
    }
  }

  // Import pattern helper
  const { getPatternData } = require('../handlers/checkin');

  // Send personalized check-in to each participant
  for (const p of participants) {
    // Build standings from their perspective
    let standingsStr = '';
    participants.forEach((other, i) => {
      const rank = i + 1;
      const you = other.phone === p.phone ? ' ←' : '';
      standingsStr += `${rank}. ${other.name} (${other.score}/${dayNum - 1})${you}\n`;
    });

    // Get their pattern
    const pattern = await getPatternData(p.id, challenge.id);
    
    // Build personalized pressure
    let pressure = '';
    const playerRank = participants.findIndex(x => x.phone === p.phone) + 1;
    const leader = participants[0];
    const last = participants[participants.length - 1];
    
    if (playerRank === participants.length && participants.length > 1) {
      // Last place
      const gap = leader.score - p.score;
      if (pattern.missStreak >= 2) {
        pressure = `${pattern.missStreak} misses in a row. ${gap} behind ${leader.name}.`;
      } else {
        pressure = `You're last. ${gap} behind.`;
      }
    } else if (playerRank === 1) {
      if (pattern.streak >= 3) {
        pressure = `${pattern.streak} day streak. Stay on top.`;
      } else {
        pressure = `You're leading. Keep it.`;
      }
    } else {
      if (pattern.pattern) {
        pressure = `${pattern.pattern}.`;
      }
    }

    const msg = `Day ${dayNum}/${challenge.duration_days}\n\n` +
      `"${challenge.goal}"\n\n` +
      `${standingsStr}\n` +
      (pressure ? `${pressure}\n\n` : '') +
      `Did you complete it?\nYES or NO`;

    await sendSMS(p.phone, msg);
  }

  console.log(`📤 Sent check-ins for challenge ${challenge.id} (Day ${dayNum})`);
}

async function markNoResponses() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Find all check-ins from yesterday with no response
  const { data: noResponses } = await supabase
    .from('check_ins')
    .select('*, participants(*), challenges(*)')
    .eq('date', yesterdayStr)
    .is('response', null);

  for (const checkIn of noResponses || []) {
    // Mark as 'none'
    await supabase
      .from('check_ins')
      .update({ response: 'none' })
      .eq('id', checkIn.id);

    // Notify the participant
    await sendSMS(
      checkIn.participants.phone,
      `No response yesterday. That's a miss.\n\nDon't let it happen again.`
    );

    console.log(`⚠️ Marked no-response for ${checkIn.participants.name}`);
  }
}

async function checkCompletedChallenges() {
  const today = new Date().toISOString().split('T')[0];

  // Get challenges that ended yesterday or before
  const { data: challenges } = await supabase
    .from('challenges')
    .select('*')
    .eq('status', 'active')
    .lte('end_date', today);

  for (const challenge of challenges || []) {
    await completeChallenge(challenge);
  }
}

async function completeChallenge(challenge) {
  // Update status
  await supabase
    .from('challenges')
    .update({ status: 'complete' })
    .eq('id', challenge.id);

  // Get final standings
  const standings = await getStandings(challenge.id);
  
  if (standings.length === 0) {
    return;
  }

  const winner = standings[0];
  const loser = standings[standings.length - 1];
  
  // Calculate payouts (simple: loser pays winner proportional to score difference)
  const scoreDiff = winner.score - loser.score;
  const perDayValue = challenge.stake_amount / challenge.duration_days;
  const payoutAmount = Math.round(scoreDiff * perDayValue);

  // Build final message
  let finalMsg = `CHALLENGE COMPLETE\n\n`;
  finalMsg += `"${challenge.goal}"\n\n`;
  finalMsg += `Final standings:\n`;
  
  standings.forEach((p, i) => {
    let prefix = '';
    if (i === 0) prefix = '🏆 ';
    else if (i === 1) prefix = '🥈 ';
    else if (i === 2) prefix = '🥉 ';
    else prefix = '💀 ';
    
    finalMsg += `${prefix}${p.name}: ${p.score}/${challenge.duration_days}\n`;
  });

  if (payoutAmount > 0 && winner.phone !== loser.phone) {
    finalMsg += `\nPayout:\n`;
    finalMsg += `${loser.name} pays ${winner.name}: $${payoutAmount}\n`;
    finalMsg += `\nSettle via Venmo or cash.`;
  } else {
    finalMsg += `\nNo payout - it's a tie!`;
  }

  finalMsg += `\n\nRun it again? Text START`;

  // Send to all participants
  for (const p of standings) {
    // Winner gets a GIF
    if (p.phone === winner.phone && payoutAmount > 0) {
      await sendSMSWithAIGif(p.phone, finalMsg, 'complete');
    } 
    // Loser gets a GIF too (game over)
    else if (p.phone === loser.phone && payoutAmount > 0) {
      await sendSMSWithAIGif(p.phone, finalMsg, 'failure');
    }
    // Everyone else gets regular SMS
    else {
      await sendSMS(p.phone, finalMsg);
    }
  }

  console.log(`🏁 Challenge ${challenge.id} completed. Winner: ${winner.name}, Loser: ${loser.name}, Payout: $${payoutAmount}`);
}

// Manual trigger for testing
async function triggerCheckIn(challengeId) {
  const { data: challenge } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .single();

  if (challenge) {
    await sendChallengeCheckIn(challenge);
  }
}

module.exports = { 
  startScheduler, 
  sendDailyCheckIns, 
  markNoResponses,
  checkCompletedChallenges,
  triggerCheckIn
};