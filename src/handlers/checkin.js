// ============================================================================
// FILE: src/handlers/checkin.js
// CHEENGU V2: Handle daily check-in responses with PATTERN AWARENESS
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS, sendSMSWithAIGif } = require('../services/sms');

/**
 * Determine if this day should get a GIF (first day, or milestone days)
 * For a 5-day challenge: GIFs on day 1, day 3, day 5 (completion)
 * For a 7-day challenge: GIFs on day 1, day 3, day 5, day 7 (completion)
 * General rule: day 1, then spread 1-2 more before final day
 */
function shouldSendGif(dayNum, totalDays) {
  // Always GIF on day 1 (first verified day)
  if (dayNum === 1) return true;
  
  // For short challenges (3-5 days), GIF at midpoint
  if (totalDays <= 5) {
    const midpoint = Math.ceil(totalDays / 2);
    if (dayNum === midpoint) return true;
  }
  
  // For longer challenges (6+ days), GIF at 1/3 and 2/3 marks
  if (totalDays >= 6) {
    const oneThird = Math.ceil(totalDays / 3);
    const twoThirds = Math.ceil((totalDays * 2) / 3);
    if (dayNum === oneThird || dayNum === twoThirds) return true;
  }
  
  return false;
}

/**
 * Get pattern data for a participant (streaks, recent misses, etc.)
 */
async function getPatternData(participantId, challengeId) {
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .eq('participant_id', participantId)
    .order('date', { ascending: false })
    .limit(10);

  if (!checkIns || checkIns.length === 0) {
    return { streak: 0, missStreak: 0, recentMisses: 0, recentTotal: 0, pattern: null };
  }

  // Calculate current streak (consecutive YES from most recent)
  let streak = 0;
  for (const c of checkIns) {
    if (c.response === 'yes') streak++;
    else break;
  }

  // Calculate miss streak (consecutive misses)
  let missStreak = 0;
  for (const c of checkIns) {
    if (c.response === 'no' || c.response === 'none') missStreak++;
    else break;
  }

  // Recent performance (last 4 days)
  const recent = checkIns.slice(0, 4);
  const recentMisses = recent.filter(c => c.response === 'no' || c.response === 'none').length;
  const recentTotal = recent.length;

  // Detect patterns
  let pattern = null;
  if (missStreak >= 2) {
    pattern = `missed ${missStreak} in a row`;
  } else if (recentMisses >= 2 && recentTotal >= 3) {
    pattern = `${recentMisses} of last ${recentTotal} were misses`;
  } else if (streak >= 3) {
    pattern = `${streak} day streak`;
  }

  return { streak, missStreak, recentMisses, recentTotal, pattern };
}

/**
 * Build specific pressure message based on standings and patterns
 */
async function buildPressureMessage(participant, standings, dayNum) {
  const playerRank = standings.findIndex(s => s.phone === participant.phone) + 1;
  const playerScore = standings.find(s => s.phone === participant.phone)?.score || 0;
  const leader = standings[0];
  const last = standings[standings.length - 1];
  
  const pattern = await getPatternData(participant.id, participant.challenge_id);
  
  let msg = '';

  // Position-based pressure
  if (playerRank === 1) {
    if (pattern.streak >= 3) {
      msg = `${pattern.streak} day streak. You're leading.`;
    } else {
      msg = `You're in first. Don't slip.`;
    }
  } else if (playerRank === standings.length) {
    // Last place - maximum pressure
    if (pattern.pattern) {
      msg = `Last place. ${pattern.pattern}. `;
    } else {
      msg = `You're last. `;
    }
    const gap = leader.score - playerScore;
    msg += `${gap} behind ${leader.name}.`;
  } else {
    // Middle of pack
    if (pattern.missStreak >= 2) {
      msg = `${pattern.pattern}. You're slipping to the bottom.`;
    } else {
      const gap = leader.score - playerScore;
      if (gap > 0) {
        msg = `${gap} behind ${leader.name}.`;
      } else {
        msg = `Tied for the lead. Stay sharp.`;
      }
    }
  }

  return msg;
}

async function handleCheckInResponse(phone, message) {
  const upper = message.trim().toUpperCase();
  
  // Accept variations
  const isYes = ['YES', 'Y', 'YEP', 'YEAH', 'YUP', 'DONE', '1'].includes(upper);
  const isNo = ['NO', 'N', 'NOPE', 'NAH', 'MISSED', '0'].includes(upper);
  
  if (!isYes && !isNo) {
    return false;
  }

  // Find active participant
  const { data: participant } = await supabase
    .from('participants')
    .select('*, challenges(*)')
    .eq('phone', phone)
    .eq('status', 'accepted')
    .eq('challenges.status', 'active')
    .limit(1)
    .single();

  if (!participant) {
    return false;
  }

  const today = new Date().toISOString().split('T')[0];
  
  // Find today's check-in
  const { data: checkIn } = await supabase
    .from('check_ins')
    .select('*')
    .eq('participant_id', participant.id)
    .eq('date', today)
    .single();

  if (!checkIn) {
    await sendSMS(phone, "No check-in pending today.");
    return true;
  }

  if (checkIn.response) {
    await sendSMS(phone, "Already logged today. Wait for tomorrow.");
    return true;
  }

  const response = isYes ? 'yes' : 'no';
  
  // Record the response
  await supabase
    .from('check_ins')
    .update({
      response,
      responded_at: new Date().toISOString()
    })
    .eq('id', checkIn.id);

  // Update score if YES
  if (isYes) {
    await supabase
      .from('participants')
      .update({ 
        score: (participant.score || 0) + 1 
      })
      .eq('id', participant.id);
    
    // Refresh participant data
    participant.score = (participant.score || 0) + 1;
  }

  // Get current standings
  const standings = await getStandings(participant.challenges.id);
  
  // Build response with specific pressure
  const pressure = await buildPressureMessage(participant, standings, checkIn.day_number);
  const totalDays = participant.challenges.duration_days;
  
  let msg;
  if (isYes) {
    msg = `Logged. ${participant.score}/${checkIn.day_number}\n\n${pressure}`;
    
    // Send GIF on milestone days for YES responses
    if (shouldSendGif(checkIn.day_number, totalDays)) {
      const context = checkIn.day_number === 1 ? 'success' : 'complete';
      await sendSMSWithAIGif(phone, msg, context);
    } else {
      await sendSMS(phone, msg);
    }
  } else {
    const pattern = await getPatternData(participant.id, participant.challenges.id);
    if (pattern.missStreak >= 2) {
      msg = `Miss. ${pattern.missStreak} in a row now.\n\n${pressure}`;
    } else {
      msg = `Miss.\n\n${pressure}`;
    }
    
    // Send failure GIF on milestone days for NO responses
    if (shouldSendGif(checkIn.day_number, totalDays)) {
      await sendSMSWithAIGif(phone, msg, 'failure');
    } else {
      await sendSMS(phone, msg);
    }
  }

  // Check if everyone has responded
  await checkAllResponded(participant.challenges.id, today, checkIn.day_number);

  return true;
}

async function getStandings(challengeId) {
  const { data: participants } = await supabase
    .from('participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('status', 'accepted')
    .order('score', { ascending: false });

  return participants || [];
}

async function checkAllResponded(challengeId, date, dayNum) {
  // Get all check-ins for today
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('date', date);

  const allResponded = checkIns?.every(c => c.response !== null);
  
  if (allResponded && checkIns?.length > 0) {
    // Everyone responded - send standings update
    const standings = await getStandings(challengeId);
    
    const { data: challenge } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    // Build standings with specific comparisons
    let standingsMsg = `Day ${dayNum} complete.\n\n`;
    
    standings.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '💀';
      standingsMsg += `${medal} ${p.name}: ${p.score}/${dayNum}\n`;
    });

    // Add specific pressure for last place
    const last = standings[standings.length - 1];
    const first = standings[0];
    const gap = first.score - last.score;
    
    if (gap > 0) {
      standingsMsg += `\n${last.name} is ${gap} behind. Don't be ${last.name}.`;
    }

    // Send to everyone
    for (const p of standings) {
      await sendSMS(p.phone, standingsMsg);
    }
  }
}

async function handleStatusRequest(phone) {
  // Find active challenge
  const { data: participant } = await supabase
    .from('participants')
    .select('*, challenges(*)')
    .eq('phone', phone)
    .eq('status', 'accepted')
    .eq('challenges.status', 'active')
    .limit(1)
    .single();

  if (!participant) {
    await sendSMS(phone, "No active challenge.\n\nText START to create one\nOr MATCH to join one");
    return true;
  }

  const challenge = participant.challenges;
  const standings = await getStandings(challenge.id);
  
  // Calculate day number
  const startDate = new Date(challenge.start_date);
  const today = new Date();
  const dayNum = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;

  // Get pattern for this user
  const pattern = await getPatternData(participant.id, challenge.id);

  let msg = `"${challenge.goal}"\n`;
  msg += `Day ${dayNum}/${challenge.duration_days}\n`;
  
  if (pattern.pattern) {
    msg += `Your trend: ${pattern.pattern}\n`;
  }
  
  msg += `\nStandings:\n`;
  
  standings.forEach((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '💀';
    const you = p.phone === phone ? ' ← you' : '';
    msg += `${medal} ${p.name}: ${p.score}/${dayNum}${you}\n`;
  });

  // Specific comparison
  const playerRank = standings.findIndex(s => s.phone === phone) + 1;
  if (playerRank > 1) {
    const leader = standings[0];
    const playerScore = standings[playerRank - 1].score;
    const gap = leader.score - playerScore;
    if (gap > 0) {
      msg += `\n${gap} behind ${leader.name}.`;
    }
  }

  msg += `\n\nStake: $${challenge.stake_amount}`;

  await sendSMS(phone, msg);
  return true;
}

module.exports = { handleCheckInResponse, getStandings, handleStatusRequest, getPatternData };