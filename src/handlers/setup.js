// src/handlers/setup.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');
const { interpretInput, needsInterpretation } = require('../services/interpreter');

async function handleSetupFlow(phone, message) {
  console.log('🔧 handleSetupFlow called with:', phone, message);
  
  const normalizedPhone = normalizePhone(phone);
  console.log('📞 Normalized phone:', normalizedPhone);
  
  const upperMessage = message.trim().toUpperCase();
  const lowerMessage = message.trim().toLowerCase();

  // Fetch setup state early so it's available throughout the function
  let { data: setupState, error: setupError } = await supabase
    .from('setup_state')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();
  
  console.log('🔍 Setup state:', setupState ? setupState.current_step : 'none');

  // Keyword matching for common command variations
  if (lowerMessage.includes('cancel') || lowerMessage.includes('stop') || lowerMessage === 'quit') {
    // Treat as RESET
    const { data: activeUsers } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active');
    
    if (activeUsers && activeUsers.length > 0) {
      await sendSMS(normalizedPhone, "NEGATIVE. You made a commitment, and you WILL see it through. No quitting on my watch.\n\nText STATUS for your progress.");
      return;
    }
    
    const { data: setupToCancel } = await supabase
      .from('setup_state')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();
    
    if (setupToCancel) {
      await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
      await sendSMS(normalizedPhone, "Fine. Setup cancelled. When you're ready to stop being soft, text START.");
    } else {
      await sendSMS(normalizedPhone, "Nothing to cancel. You haven't even started yet. Text START when you grow a spine.");
    }
    return;
  }
  
  if (lowerMessage === 'help' || lowerMessage === 'commands' || lowerMessage === '?') {
    await sendSMS(normalizedPhone, 
      `LISTEN UP. Here's how this works:\n\n` +
      `START - Make a commitment\n` +
      `STATUS - Check your progress\n` +
      `HISTORY - Your track record\n` +
      `CHANGE - Fix a mistake\n` +
      `RESET - Quit setup (coward's way out)\n\n` +
      `Now stop asking questions and START.`
    );
    return;
  }

  // Handle CHANGE command - fix past day's outcome
  if (upperMessage === 'CHANGE') {
    const { data: activeUser } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .single();
    
    const { data: judging } = await supabase
      .from('judges')
      .select('*, users(*)')
      .eq('phone', normalizedPhone)
      .eq('consent_status', 'accepted');
    
    const activeJudging = judging?.filter(j => j.users?.status === 'active') || [];
    
    if (!activeUser && activeJudging.length === 0) {
      await sendSMS(normalizedPhone, "You got nothing to change. No active commitments. Text START.");
      return;
    }
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    let recentLogs = [];
    
    if (activeUser) {
      const { data: userLogs } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('user_id', activeUser.id)
        .gte('date', sevenDaysAgo.toISOString().split('T')[0])
        .order('date', { ascending: false })
        .limit(5);
      
      if (userLogs) {
        recentLogs = userLogs.map(log => ({
          ...log,
          userName: activeUser.user_name || 'You',
          isOwnCommitment: true
        }));
      }
    }
    
    for (const j of activeJudging) {
      const { data: judgeLogs } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('user_id', j.user_id)
        .gte('date', sevenDaysAgo.toISOString().split('T')[0])
        .order('date', { ascending: false })
        .limit(5);
      
      if (judgeLogs) {
        recentLogs = recentLogs.concat(judgeLogs.map(log => ({
          ...log,
          userName: j.users.user_name || j.users.phone.slice(-4),
          isOwnCommitment: false,
          userId: j.user_id
        })));
      }
    }
    
    if (recentLogs.length === 0) {
      await sendSMS(normalizedPhone, "No recent days to change. Move along.");
      return;
    }
    
    recentLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
    recentLogs = recentLogs.slice(0, 7);
    
    await supabase
      .from('setup_state')
      .upsert({
        phone: normalizedPhone,
        current_step: 'awaiting_change_selection',
        temp_commitment: JSON.stringify(recentLogs)
      });
    
    let menuMsg = `RECENT DAYS:\n\n`;
    recentLogs.forEach((log, i) => {
      const status = log.outcome === 'pass' ? '✅' : log.outcome === 'fail' ? '❌' : '⏳';
      const name = log.isOwnCommitment ? '' : `(${log.userName}) `;
      menuMsg += `${i + 1}. ${log.date} ${name}${status}\n`;
    });
    menuMsg += `\nReply: [#] PASS or [#] FAIL`;
    
    await sendSMS(normalizedPhone, menuMsg);
    return;
  }

  // Handle CHANGE selection response
  if (setupState && setupState.current_step === 'awaiting_change_selection') {
    const match = message.trim().toUpperCase().match(/^(\d+)\s*(PASS|FAIL)$/);
    
    if (!match) {
      await sendSMS(normalizedPhone, "I said NUMBER then PASS or FAIL. Try again.");
      return;
    }
    
    const index = parseInt(match[1]) - 1;
    const newOutcome = match[2].toLowerCase();
    
    let logs;
    try {
      logs = JSON.parse(setupState.temp_commitment);
    } catch (e) {
      await sendSMS(normalizedPhone, "Something broke. Text CHANGE to try again.");
      await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
      return;
    }
    
    if (index < 0 || index >= logs.length) {
      await sendSMS(normalizedPhone, "Invalid number. Pay attention. Text CHANGE to see the list.");
      return;
    }
    
    const log = logs[index];
    const oldOutcome = log.outcome;
    
    await supabase
      .from('daily_logs')
      .update({ outcome: newOutcome, judge_verified: true })
      .eq('id', log.id);
    
    if (oldOutcome !== newOutcome) {
      const userId = log.user_id || log.userId;
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (user) {
        const penalty = user.penalty_per_failure || 5;
        let newStake = parseFloat(user.stake_remaining);
        
        if (oldOutcome === 'pass' && newOutcome === 'fail') {
          newStake = Math.max(0, newStake - penalty);
        } else if (oldOutcome === 'fail' && newOutcome === 'pass') {
          newStake = Math.min(user.original_stake, newStake + penalty);
        }
        
        await supabase
          .from('users')
          .update({ stake_remaining: newStake })
          .eq('id', userId);
        
        if (!log.isOwnCommitment) {
          await sendSMS(user.phone, `Your judge corrected ${log.date} to ${newOutcome.toUpperCase()}. Stake: $${newStake}/$${user.original_stake}`);
        }
      }
    }
    
    await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
    
    await sendSMS(normalizedPhone, `Done. ${log.date} is now ${newOutcome.toUpperCase()}.`);
    return;
  }

  // Handle STATUS command
  if (upperMessage === 'STATUS') {
    const { data: activeUser } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .single();
    
    if (!activeUser) {
      await sendSMS(normalizedPhone, "You got no active commitment. You're not even in the fight yet.\n\nText START to change that.");
      return;
    }
    
    const daysLeft = Math.ceil((new Date(activeUser.commitment_end_date) - new Date()) / (1000 * 60 * 60 * 24));
    const judgeName = activeUser.judge_name || 'your judge';
    const percentLeft = Math.round((activeUser.stake_remaining / activeUser.original_stake) * 100);
    
    let statusMsg = `SITREP:\n\n`;
    statusMsg += `Mission: "${activeUser.commitment_text}"\n\n`;
    statusMsg += `Stake: $${activeUser.stake_remaining}/$${activeUser.original_stake} (${percentLeft}%)\n`;
    statusMsg += `Days remaining: ${daysLeft}\n`;
    statusMsg += `Judge: ${judgeName}\n\n`;
    
    if (percentLeft === 100) {
      statusMsg += `Perfect record so far. Don't get cocky.`;
    } else if (percentLeft >= 75) {
      statusMsg += `You've slipped. Tighten up.`;
    } else if (percentLeft >= 50) {
      statusMsg += `Half your stake gone. Wake up.`;
    } else {
      statusMsg += `Pathetic. You're bleeding out. Fix it.`;
    }
    
    await sendSMS(normalizedPhone, statusMsg);
    return;
  }

  // Handle HISTORY command
  if (upperMessage === 'HISTORY') {
    const { data: pastCommitments } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'completed')
      .order('commitment_end_date', { ascending: false })
      .limit(5);
    
    if (!pastCommitments || pastCommitments.length === 0) {
      await sendSMS(normalizedPhone, "No history. You haven't finished anything yet.\n\nText START and prove you can.");
      return;
    }
    
    let historyMsg = `YOUR RECORD:\n\n`;
    
    for (const c of pastCommitments) {
      const refunded = c.refund_amount || c.stake_remaining || 0;
      const lost = c.original_stake - refunded;
      const emoji = lost === 0 ? '✅' : (refunded > 0 ? '⚠️' : '❌');
      historyMsg += `${emoji} "${c.commitment_text}"\n`;
      historyMsg += `   Kept $${refunded} of $${c.original_stake}\n\n`;
    }
    
    await sendSMS(normalizedPhone, historyMsg);
    return;
  }

  // Handle HOW command
  if (upperMessage === 'HOW') {
    await sendSMS(normalizedPhone, 
      `COMMANDS:\n\n` +
      `START - Make a commitment\n` +
      `STATUS - Check progress\n` +
      `HISTORY - Past commitments\n` +
      `CHANGE - Fix a day\n` +
      `RESET - Cancel setup\n\n` +
      `Dashboard: cheengu.com/dashboard\n\n` +
      `Less talking, more doing. Text START.`
    );
    return;
  }

  // Check if user already has active commitment
  const { data: existingUsers, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .eq('status', 'active');
  
  const existingUser = existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;
  
  console.log('👤 Existing user check:', existingUser ? existingUser.id : null, userError);
  
  const whitelistedUsers = ['+15622768169'];
  
  if (existingUser && existingUser.status === 'active' && !whitelistedUsers.includes(normalizedPhone)) {
    console.log('⚠️ User already has active commitment');
    await sendSMS(
      normalizedPhone,
      "You already have a mission in progress. Finish what you started.\n\nText STATUS to check your progress."
    );
    return;
  }

  // setupState already fetched at top of function

  // Handle RESET command
  if (upperMessage === 'RESET') {
    const { data: activeUsers } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active');
    
    if (activeUsers && activeUsers.length > 0) {
      await sendSMS(normalizedPhone, "NEGATIVE. You're in the middle of a commitment. No retreat, no surrender.\n\nText STATUS.");
      return;
    }
    
    if (setupState) {
      await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
      await sendSMS(normalizedPhone, "Setup cleared. When you're done being scared, text START.");
    } else {
      await sendSMS(normalizedPhone, "Nothing to reset. Text START when you're ready to commit.");
    }
    return;
  }

  // Handle START command
  if (!setupState && upperMessage === 'START') {
    console.log('✨ Creating new setup state');
    
    const { data: newState, error: insertError } = await supabase
      .from('setup_state')
      .insert({
        phone: normalizedPhone,
        current_step: 'awaiting_name'
      })
      .select()
      .single();
    
    console.log('📝 New setup state created:', newState, insertError);
    
    if (insertError) {
      console.error('❌ Error creating setup state:', insertError);
      await sendSMS(normalizedPhone, "Something broke. Try again.");
      return;
    }
    
    await sendSMS(normalizedPhone, "Alright, let's do this. What's your name, recruit?");
    return;
  }

  // No setup state and not a command
  if (!setupState) {
    console.log('💬 No setup state, sending START prompt');
    await sendSMS(normalizedPhone, "You lost? Text START to make a commitment. Or text HOW if you need your hand held.");
    return;
  }

  // Handle name collection
  if (setupState.current_step === 'awaiting_name') {
    const userName = message.trim();
    
    if (userName.length < 1 || userName.length > 50) {
      await sendSMS(normalizedPhone, "That's not a name. Try again. Keep it simple.");
      return;
    }

    console.log('👤 Name collected:', userName);
    
    await supabase
      .from('setup_state')
      .update({
        temp_user_name: userName,
        current_step: 'awaiting_commitment'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(normalizedPhone, `${userName}. Good. Now tell me - what are you committing to? No excuses, no maybes. What's the mission?`);
    return;
  }

  // Handle commitment collection
  if (setupState.current_step === 'awaiting_commitment') {
    console.log('📋 Processing commitment:', message);
    await supabase
      .from('setup_state')
      .update({
        temp_commitment: message,
        current_step: 'awaiting_commitment_type'
      })
      .eq('phone', normalizedPhone);
    
    console.log('✅ Updated to awaiting_commitment_type');
    
    await sendSMS(
      normalizedPhone, 
      `"${message}" - Roger that.\n\nNow how do we hold you accountable?\n\nDAILY - You do this every single day. Miss one, you pay.\n\nDEADLINE - You finish by a specific date. All or nothing.\n\nWhich one?`
    );
    return;
  }

  // Handle commitment type
  if (setupState.current_step === 'awaiting_commitment_type') {
    let response = message.trim().toUpperCase();
    
    const dailyKeywords = ['DAILY', '1', 'EVERYDAY', 'EVERY DAY', 'EACH DAY'];
    const deadlineKeywords = ['DEADLINE', '2', 'ONE TIME', 'ONCE', 'BY DATE', 'END DATE'];
    
    if (dailyKeywords.includes(response)) {
      response = 'DAILY';
    } else if (deadlineKeywords.includes(response)) {
      response = 'DEADLINE';
    } else {
      await sendSMS(normalizedPhone, "I said DAILY or DEADLINE. Pick one.");
      return;
    }

    console.log('📅 Commitment type selected:', response);

    await supabase
      .from('setup_state')
      .update({
        temp_commitment_type: response.toLowerCase(),
        current_step: 'awaiting_stake_amount'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(
      normalizedPhone, 
      `${response}. Good.\n\nNow here's where it gets real. How much money are you willing to lose if you fail?\n\nPick an amount that actually HURTS. $5 to $500.`
    );
    return;
  }

  // Handle stake amount
  if (setupState.current_step === 'awaiting_stake_amount') {
    const cleanedMessage = message.replace('$', '').trim();
    let stakeAmount = parseInt(cleanedMessage);
    
    if (isNaN(stakeAmount) || stakeAmount < 5 || stakeAmount > 500) {
      if (needsInterpretation(message, 'awaiting_stake_amount')) {
        console.log('🤖 Trying AI interpreter for stake amount...');
        const aiResult = await interpretInput(message, 'awaiting_stake_amount');
        
        if (aiResult.success && aiResult.value >= 5 && aiResult.value <= 500) {
          stakeAmount = aiResult.value;
          console.log('🤖 AI parsed stake amount:', stakeAmount);
        } else {
          await sendSMS(normalizedPhone, "Give me a number between 5 and 500. No games.");
          return;
        }
      } else {
        await sendSMS(normalizedPhone, "Between $5 and $500. Try again.");
        return;
      }
    }

    console.log('💰 Stake amount selected:', stakeAmount);

    const penalty = null;
    
    await supabase
      .from('setup_state')
      .update({
        temp_stake_amount: stakeAmount,
        current_step: setupState.temp_commitment_type === 'daily' ? 'awaiting_duration' : 'awaiting_deadline_date'
      })
      .eq('phone', normalizedPhone);

    if (setupState.temp_commitment_type === 'daily') {
      await sendSMS(
        normalizedPhone, 
        `$${stakeAmount} on the line. That's what I like to see.\n\nHow many days? Give me a number. 1 to 90.`
      );
    } else {
      await supabase
        .from('setup_state')
        .update({ temp_penalty_amount: stakeAmount })
        .eq('phone', normalizedPhone);
        
      await sendSMS(
        normalizedPhone, 
        `$${stakeAmount}. All or nothing. I respect that.\n\nWhen's your deadline? Give me a date.`
      );
    }
    return;
  }

  // Handle duration
  if (setupState.current_step === 'awaiting_duration') {
    let days = parseInt(message);
    
    if (isNaN(days) || days < 1 || days > 90) {
      if (needsInterpretation(message, 'awaiting_duration')) {
        console.log('🤖 Trying AI interpreter for duration...');
        const aiResult = await interpretInput(message, 'awaiting_duration');
        
        if (aiResult.success && aiResult.value >= 1 && aiResult.value <= 90) {
          days = aiResult.value;
          console.log('🤖 AI parsed duration:', days);
        } else {
          await sendSMS(normalizedPhone, "Give me a number. 1 to 90 days. Not that hard.");
          return;
        }
      } else {
        await sendSMS(normalizedPhone, "A NUMBER. Between 1 and 90. Try again.");
        return;
      }
    }

    console.log('📆 Duration set:', days, 'days');
    
    const stakeAmount = setupState.temp_stake_amount || 20;
    const penalty = Math.max(1, Math.round(stakeAmount / days));
    
    await supabase
      .from('setup_state')
      .update({
        temp_deadline_date: days.toString(),
        temp_penalty_amount: penalty,
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(
      normalizedPhone, 
      `${days} days. Every day you miss costs you $${penalty}.\n\nNow I need someone to hold you accountable. Someone who won't let you off easy.\n\nGive me their name and number. (Example: Sarah 555-123-4567)`
    );
    return;
  }

  // Handle deadline date
  if (setupState.current_step === 'awaiting_deadline_date') {
    console.log('📆 Processing deadline date:', message);
    
    let parsedDate = parseDeadlineDate(message);
    
    if (!parsedDate && needsInterpretation(message, 'awaiting_deadline_date')) {
      console.log('🤖 Trying AI interpreter for deadline date...');
      const aiResult = await interpretInput(message, 'awaiting_deadline_date');
      
      if (aiResult.success) {
        parsedDate = aiResult.value;
        console.log('🤖 AI parsed deadline date:', parsedDate);
      } else {
        await sendSMS(normalizedPhone, "I need a real date. Try again. (Example: Mar 15, next Friday, 2 weeks)");
        return;
      }
    }
    
    if (!parsedDate) {
      await sendSMS(normalizedPhone, "That's not a date I understand. Try: Apr 30, 2 weeks, next Monday");
      return;
    }

    await supabase
      .from('setup_state')
      .update({
        temp_deadline_date: parsedDate,
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    const dateObj = new Date(parsedDate);
    const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    await sendSMS(normalizedPhone, `Deadline: ${formattedDate}. Locked in.\n\nNow who's going to verify you actually did it? Give me their name and number.\n\n(Example: Mike 555-123-4567)`);
    return;
  }

  // Handle judge phone
  if (setupState.current_step === 'awaiting_judge_phone') {
    console.log('👨‍⚖️ Processing judge info:', message);
    
    const noJudgeKeywords = ['don\'t have', 'dont have', 'no one', 'nobody', 'alone', 'by myself'];
    if (noJudgeKeywords.some(kw => message.toLowerCase().includes(kw))) {
      await sendSMS(normalizedPhone, "Wrong answer. Everyone has SOMEONE. A friend, a family member, a coworker. Find one.\n\nName and number. Now.");
      return;
    }
    
    const parts = message.trim().split(/\s+/);
    
    if (parts.length < 2) {
      await sendSMS(normalizedPhone, "I need NAME and NUMBER. Both. Try again.");
      return;
    }
    
    const phonepart = parts[parts.length - 1];
    let judgeName = parts.slice(0, -1).join(' ');
    const judgePhone = normalizePhone(phonepart);
    
    judgeName = judgeName.replace(/[?!.,]/g, '').trim();
    
    if (judgePhone === normalizedPhone) {
      console.log('⚠️ User tried to be their own judge');
      await sendSMS(normalizedPhone, "Nice try. You can't judge yourself. That's the whole point. Give me someone ELSE.");
      return;
    }
    
    if (!judgePhone || judgePhone.length < 10) {
      await sendSMS(normalizedPhone, "That number doesn't look right. Format: Name 555-123-4567");
      return;
    }

    const whitelistedJudges = ['+15622768169'];
    
    if (!whitelistedJudges.includes(judgePhone)) {
      const { data: existingJudge } = await supabase
        .from('judges')
        .select('*, users(*)')
        .eq('phone', judgePhone)
        .in('consent_status', ['pending', 'accepted']);
      
      const activeJudging = existingJudge?.filter(j => 
        j.users && (j.users.status === 'active' || j.users.status === 'awaiting_judge')
      );

      if (activeJudging && activeJudging.length > 0) {
        console.log('⚠️ Judge already has an active commitment');
        await sendSMS(normalizedPhone, `${judgeName} is already judging someone else. Pick another person.`);
        return;
      }
    }

    console.log('👨‍⚖️ Judge name:', judgeName, 'Phone:', judgePhone);
    
    const stakeAmount = setupState.temp_stake_amount || 20;
    const penaltyAmount = setupState.temp_penalty_amount || 5;
    const userName = setupState.temp_user_name || 'Someone';
    const commitmentType = setupState.temp_commitment_type;
    const commitmentText = setupState.temp_commitment;
    
    let commitmentStartDate = new Date();
    let commitmentEndDate;
    let duration;
    
    if (commitmentType === 'daily') {
      duration = parseInt(setupState.temp_deadline_date) || 7;
      commitmentEndDate = new Date();
      commitmentEndDate.setDate(commitmentEndDate.getDate() + duration);
    } else {
      commitmentEndDate = new Date(setupState.temp_deadline_date);
      duration = Math.ceil((commitmentEndDate - commitmentStartDate) / (1000 * 60 * 60 * 24));
    }
    
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        phone: normalizedPhone,
        user_name: userName,
        commitment_text: commitmentText,
        commitment_type: commitmentType,
        commitment_start_date: commitmentStartDate.toISOString().split('T')[0],
        commitment_end_date: commitmentEndDate.toISOString().split('T')[0],
        commitment_duration: duration,
        deadline_date: commitmentType === 'deadline' ? setupState.temp_deadline_date : null,
        judge_phone: judgePhone,
        judge_name: judgeName,
        original_stake: stakeAmount,
        stake_remaining: stakeAmount,
        penalty_per_failure: penaltyAmount,
        status: 'awaiting_judge',
        timezone: 'America/Los_Angeles'
      })
      .select()
      .single();
    
    if (userError) {
      console.error('❌ Error creating user:', userError);
      await sendSMS(normalizedPhone, "Something broke. Text START to try again.");
      return;
    }
    
    await supabase
      .from('judges')
      .insert({
        phone: judgePhone,
        user_id: newUser.id,
        consent_status: 'pending'
      });
    
    await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
    
    await sendSMS(
      normalizedPhone,
      `Good. Contacting ${judgeName} now.\n\nWhen they accept, your mission begins. No turning back.`
    );
    
    await sendSMS(
      judgePhone,
      `${userName} needs an accountability partner.\n\n` +
      `Mission: "${commitmentText}"\n` +
      `Stakes: $${stakeAmount}${commitmentType === 'daily' ? ` ($${penaltyAmount}/day)` : ' (all or nothing)'}\n` +
      `Duration: ${duration} days\n\n` +
      `If they fail, they owe you.\n\n` +
      `Reply ACCEPT to hold them accountable.\nReply DECLINE if you're not up for it.`
    );
    
    console.log('✅ Commitment created, judge contacted');
    return;
  }
  
  console.log('⚠️ Unexpected state:', setupState.current_step);
}

// Simple date parser
function parseDeadlineDate(input) {
  const cleaned = input.trim().toLowerCase();
  const now = new Date();
  const currentYear = now.getFullYear();
  
  if (cleaned.includes('next')) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const day = days.find(d => cleaned.includes(d));
    if (day) {
      const targetDay = days.indexOf(day);
      const currentDay = now.getDay();
      const daysUntil = (targetDay + 7 - currentDay) % 7 || 7;
      const date = new Date(now);
      date.setDate(date.getDate() + daysUntil);
      return date.toISOString().split('T')[0];
    }
  }
  
  const durationMatch = cleaned.match(/^(\d+)\s*(day|days|week|weeks|month|months)$/);
  if (durationMatch) {
    const num = parseInt(durationMatch[1]);
    const unit = durationMatch[2];
    const date = new Date(now);
    
    if (unit.startsWith('day')) {
      date.setDate(date.getDate() + num);
    } else if (unit.startsWith('week')) {
      date.setDate(date.getDate() + (num * 7));
    } else if (unit.startsWith('month')) {
      date.setMonth(date.getMonth() + num);
    }
    
    return date.toISOString().split('T')[0];
  }
  
  const wordNumbers = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12
  };
  
  const wordDurationMatch = cleaned.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(day|days|week|weeks|month|months)$/);
  if (wordDurationMatch) {
    const num = wordNumbers[wordDurationMatch[1]];
    const unit = wordDurationMatch[2];
    const date = new Date(now);
    
    if (unit.startsWith('day')) {
      date.setDate(date.getDate() + num);
    } else if (unit.startsWith('week')) {
      date.setDate(date.getDate() + (num * 7));
    } else if (unit.startsWith('month')) {
      date.setMonth(date.getMonth() + num);
    }
    
    return date.toISOString().split('T')[0];
  }
  
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1]) - 1;
    const day = parseInt(slashMatch[2]);
    let year = currentYear;
    
    const testDate = new Date(year, month, day);
    if (testDate < now) {
      year++;
    }
    
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  const months = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'sept': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };
  
  const monthMatch = cleaned.match(/^([a-z]+)\s*(\d{1,2})$/);
  if (monthMatch) {
    const monthStr = monthMatch[1];
    const day = parseInt(monthMatch[2]);
    const month = months[monthStr];
    
    if (month !== undefined) {
      let year = currentYear;
      const testDate = new Date(year, month, day);
      if (testDate < now) {
        year++;
      }
      
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }
  
  const dashMatch = cleaned.match(/^(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    const month = parseInt(dashMatch[1]) - 1;
    const day = parseInt(dashMatch[2]);
    let year = currentYear;
    
    const testDate = new Date(year, month, day);
    if (testDate < now) {
      year++;
    }
    
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) {
    return parsed.toISOString().split('T')[0];
  }
  
  return null;
}

module.exports = { handleSetupFlow };