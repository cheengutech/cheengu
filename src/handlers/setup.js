// src/handlers/setup.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');
const { stripe } = require('../config/stripe');

async function handleSetupFlow(phone, message) {
  console.log('🔧 handleSetupFlow called with:', phone, message);
  
  const normalizedPhone = normalizePhone(phone);
  console.log('📞 Normalized phone:', normalizedPhone);
  
  const upperMessage = message.trim().toUpperCase();

  // Handle STATUS command - check current commitment (works anytime)
  if (upperMessage === 'STATUS') {
    const { data: activeUser } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .single();
    
    if (!activeUser) {
      await sendSMS(normalizedPhone, "You don't have an active commitment right now.\n\nText START to begin one!");
      return;
    }
    
    const daysLeft = Math.ceil((new Date(activeUser.commitment_end_date) - new Date()) / (1000 * 60 * 60 * 24));
    const judgeName = activeUser.judge_name || 'your judge';
    
    await sendSMS(normalizedPhone,
      `📊 Your Current Commitment:\n\n` +
      `"${activeUser.commitment_text}"\n\n` +
      `💰 Stake remaining: $${activeUser.stake_remaining} of $${activeUser.original_stake}\n` +
      `📅 ${daysLeft} days left\n` +
      `👤 Judge: ${judgeName}\n\n` +
      `Keep going! 💪`
    );
    return;
  }

  // Handle HISTORY command - see past commitments (works anytime)
  if (upperMessage === 'HISTORY') {
    const { data: pastCommitments } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'completed')
      .order('commitment_end_date', { ascending: false })
      .limit(5);
    
    if (!pastCommitments || pastCommitments.length === 0) {
      await sendSMS(normalizedPhone, "No completed commitments yet.\n\nText START to begin your first one!");
      return;
    }
    
    let historyMsg = `📜 Your Past Commitments:\n\n`;
    
    for (const c of pastCommitments) {
      const refunded = c.refund_amount || c.stake_remaining || 0;
      const lost = c.original_stake - refunded;
      const emoji = lost === 0 ? '✅' : (refunded > 0 ? '⚠️' : '❌');
      historyMsg += `${emoji} "${c.commitment_text}"\n`;
      historyMsg += `   $${refunded}/$${c.original_stake} returned\n\n`;
    }
    
    await sendSMS(normalizedPhone, historyMsg);
    return;
  }

  // Handle HOW command (works anytime)
  if (upperMessage === 'HOW') {
    await sendSMS(normalizedPhone, 
      `Cheengu Commands:\n\n` +
      `START - Begin a new commitment\n` +
      `STATUS - Check your current commitment\n` +
      `HISTORY - See past commitments\n` +
      `MENU - Judge someone early\n` +
      `RESET - Cancel setup and start over\n` +
      `UNDO - Judge: fix a mistake (5 min window)\n\n` +
      `📊 Dashboard: cheengu.com/dashboard\n\n` +
      `Questions? Just reply here.`
    );
    return;
  }

  // Check if user already exists and is active
  const { data: existingUsers, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .eq('status', 'active');
  
  const existingUser = existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;
  
  console.log('👤 Existing user check:', existingUser ? existingUser.id : null, userError);
  
  if (existingUser && existingUser.status === 'active') {
    console.log('⚠️ User already has active commitment');
    await sendSMS(
      normalizedPhone,
      'You already have an active commitment. Complete it first before starting a new one.\n\nText STATUS to check your progress, or HOW for help.'
    );
    return;
  }

  // Get or create setup state
  let { data: setupState, error: setupError } = await supabase
    .from('setup_state')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  console.log('🔍 Setup state check:', setupState, setupError);

  // Handle RESET command - clear setup state and start fresh
  if (upperMessage === 'RESET') {
    // Check if they have an active commitment
    const { data: activeUsers } = await supabase
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active');
    
    if (activeUsers && activeUsers.length > 0) {
      await sendSMS(normalizedPhone, "You have an active commitment - no backing out now! 💪\n\nText STATUS to check your progress, or HOW for help.");
      return;
    }
    
    if (setupState) {
      await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
      await sendSMS(normalizedPhone, 'Setup cancelled. Text START to begin a new commitment.');
    } else {
      await sendSMS(normalizedPhone, 'Nothing to reset. Text START to begin a new commitment.');
    }
    return;
  }

  // Handle START command - begin new setup
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
      await sendSMS(normalizedPhone, 'Sorry, something went wrong. Please try again.');
      return;
    }
    
    await sendSMS(normalizedPhone, "Let's set up your commitment! First, what's your name?\n\n(e.g., Brian)");
    return;
  }

  // No setup state and not a command - prompt to start
  if (!setupState) {
    console.log('💬 No setup state, sending START prompt');
    await sendSMS(normalizedPhone, 'Text START to begin a new commitment, or HOW for help.');
    return;
  }

  // Handle name collection
  if (setupState.current_step === 'awaiting_name') {
    const userName = message.trim();
    
    if (userName.length < 1 || userName.length > 50) {
      await sendSMS(normalizedPhone, 'Please enter a valid name (1-50 characters).');
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
    
    await sendSMS(normalizedPhone, `Hey ${userName}! What's your commitment?\n\nExamples:\n• "Do 50 pushups daily"\n• "Launch my landing page by Feb 1"\n• "No alcohol for 30 days"`);
    return;
  }

  // Handle setup steps
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
      `Got it: "${message}"\n\nNow choose your accountability style:\n\n• Reply DAILY if you need to do this every single day (you'll get checked daily)\n\n• Reply DEADLINE if you need to complete this by a specific date (you'll get checked once at the end)\n\nWhich works better for your goal?`
    );
    return;
  }

  if (setupState.current_step === 'awaiting_commitment_type') {
    const response = message.toUpperCase();
    
    if (response !== 'DAILY' && response !== 'DEADLINE') {
      await sendSMS(normalizedPhone, 'Please reply with either DAILY or DEADLINE.');
      return;
    }

    console.log('📅 Commitment type selected:', response);

    // Ask for stake amount before duration/deadline
    await supabase
      .from('setup_state')
      .update({
        temp_commitment_type: response.toLowerCase(),
        current_step: 'awaiting_stake_amount'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(
      normalizedPhone, 
      `Nice! ${response === 'DAILY' ? 'Daily check-ins' : 'One final check-in'} locked in.\n\nLast step: pick your stake. What amount would actually motivate you to follow through?\n\nReply with any amount from $5 to $500:`
    );
    return;
  }

  // Handle stake amount selection
  if (setupState.current_step === 'awaiting_stake_amount') {
    // Remove $ sign if present and parse
    const cleanedMessage = message.replace('$', '').trim();
    const stakeAmount = parseInt(cleanedMessage);
    
    if (isNaN(stakeAmount) || stakeAmount < 5 || stakeAmount > 500) {
      await sendSMS(normalizedPhone, 'Please enter an amount between $5 and $500.');
      return;
    }

    console.log('💰 Stake amount selected:', stakeAmount);

    // Calculate penalty (stake ÷ days, minimum $5)
    // Note: For daily commitments, we'll recalculate once we know the duration
    // For now, store null and calculate after we get days
    const penalty = null; // Will be calculated after duration is set
    
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
        `$${stakeAmount} it is! 💪\n\nYour judge will verify every day at 8pm.\n\nHow many days? (Example: 7 for one week, 30 for one month)`
      );
    } else {
      // For deadline commitments, penalty is the full stake (all or nothing)
      await supabase
        .from('setup_state')
        .update({ temp_penalty_amount: stakeAmount })
        .eq('phone', normalizedPhone);
        
      await sendSMS(
        normalizedPhone, 
        `$${stakeAmount} it is! 💪\n\nYour judge will verify on the deadline. Miss it and you lose the full stake.\n\nWhen's your deadline? (Examples: "Jan 31", "2/15", "next Friday")`
      );
    }
    return;
  }

  if (setupState.current_step === 'awaiting_duration') {
    const days = parseInt(message);
    
    if (isNaN(days) || days < 1 || days > 90) {
      await sendSMS(normalizedPhone, 'Please enter a number between 1 and 90 days.');
      return;
    }

    console.log('📆 Duration set:', days, 'days');
    
    // Calculate penalty: stake ÷ days, minimum $1, rounded to nearest dollar
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
      `${days} days - locked in! Each missed day = -$${penalty}.\n\nWho's going to keep you honest? Send their name and number:\n\n(e.g., Brian 562-XXX-XXXX)`
    );
    return;
  }

  if (setupState.current_step === 'awaiting_deadline_date') {
    console.log('📆 Processing deadline date:', message);
    
    const parsedDate = parseDeadlineDate(message);
    
    if (!parsedDate) {
      await sendSMS(normalizedPhone, 'Hmm, couldn\'t understand that date. Try something like: Jan 31, 2/15, or next Friday');
      return;
    }

    await supabase
      .from('setup_state')
      .update({
        temp_deadline_date: parsedDate,
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(normalizedPhone, `Deadline set! 📅\n\nWho's going to keep you honest? Send their name and number:\n\n(e.g., Brian 562-XXX-XXXX)`);
    return;
  }

  if (setupState.current_step === 'awaiting_judge_phone') {
    console.log('👨‍⚖️ Processing judge info:', message);
    
    // Parse name and phone from input like "Justin 818-480-8293" or "Justin 8184808293"
    const parts = message.trim().split(/\s+/);
    
    if (parts.length < 2) {
      await sendSMS(normalizedPhone, "Please include both name and number.\n\n(e.g., Brian 562-XXX-XXXX)");
      return;
    }
    
    // Last part is the phone number, everything before is the name
    const phonepart = parts[parts.length - 1];
    const judgeName = parts.slice(0, -1).join(' ');
    const judgePhone = normalizePhone(phonepart);
    
    if (judgePhone === normalizedPhone) {
      console.log('⚠️ User tried to be their own judge');
      await sendSMS(normalizedPhone, "Nice try 😄 You can't be your own judge. Who else can hold you accountable?");
      return;
    }
    
    if (!judgePhone || judgePhone.length < 10) {
      await sendSMS(normalizedPhone, "Couldn't read that number. Try again:\n\n(e.g., Brian 562-XXX-XXXX)");
      return;
    }

    // Check if this judge is already judging someone else
    // Whitelist Brian's number for multiple commitments during onboarding
    const whitelistedJudges = ['+15622768169'];
    
    if (!whitelistedJudges.includes(judgePhone)) {
      const { data: existingJudge } = await supabase
        .from('judges')
        .select('*, users(*)')
        .eq('phone', judgePhone)
        .in('consent_status', ['pending', 'accepted']);
      
      // Filter to only active commitments
      const activeJudging = existingJudge?.filter(j => 
        j.users && (j.users.status === 'active' || j.users.status === 'awaiting_judge')
      );

      if (activeJudging && activeJudging.length > 0) {
        console.log('⚠️ Judge already has an active commitment');
        await sendSMS(normalizedPhone, `${judgeName} is already judging someone else's commitment. Please choose a different judge.`);
        return;
      }
    }

    console.log('👨‍⚖️ Judge name:', judgeName, 'Phone:', judgePhone);
    console.log('💳 Creating Stripe payment intent');
    
    const stakeAmount = setupState.temp_stake_amount || 20;
    const penaltyAmount = setupState.temp_penalty_amount || 5;
    const userName = setupState.temp_user_name || 'Someone';
    
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: stakeAmount * 100,
        currency: 'usd',
        metadata: {
          phone: normalizedPhone,
          user_name: userName,
          commitment: setupState.temp_commitment,
          commitment_type: setupState.temp_commitment_type,
          deadline_date: setupState.temp_deadline_date || '',
          judge_phone: judgePhone,
          judge_name: judgeName,
          stake_amount: stakeAmount.toString(),
          penalty_amount: penaltyAmount.toString()
        }
      });

      console.log('✅ Payment intent created:', paymentIntent.id);

      await supabase
        .from('setup_state')
        .update({
          temp_judge_phone: judgePhone,
          temp_judge_name: judgeName,
          current_step: 'awaiting_payment'
        })
        .eq('phone', normalizedPhone);

      console.log('✅ Updated to awaiting_payment');

      const paymentLink = `${process.env.APP_URL}/pay/${paymentIntent.id}`;
      console.log('🔗 Payment link:', paymentLink);
      
      await sendSMS(
        normalizedPhone,
        `Almost there! Stake your $${stakeAmount} to lock it in:\n\n${paymentLink}\n\nOnce paid, we'll reach out to ${judgeName}.`
      );
    } catch (stripeError) {
      console.error('❌ Stripe error:', stripeError);
      await sendSMS(normalizedPhone, 'Sorry, something went wrong setting up payment. Please try again.');
    }
    return;
  }
  
  // Handle awaiting_payment state - user hasn't paid yet
  if (setupState.current_step === 'awaiting_payment') {
    // Check if they want to restart
    if (upperMessage === 'START') {
      await supabase.from('setup_state').delete().eq('phone', normalizedPhone);
      await sendSMS(normalizedPhone, 'Previous setup cleared. Let\'s start fresh!\n\nWhat\'s your name?\n\n(e.g., Brian)');
      
      await supabase
        .from('setup_state')
        .insert({
          phone: normalizedPhone,
          current_step: 'awaiting_name'
        });
      return;
    }
    
    // Otherwise, remind them to pay
    const stakeAmount = setupState.temp_stake_amount || 20;
    await sendSMS(
      normalizedPhone,
      `You have a pending commitment waiting for payment ($${stakeAmount}).\n\nReply START to cancel and begin fresh, or complete your payment to activate.`
    );
    return;
  }
  
  console.log('⚠️ Unexpected state:', setupState.current_step);
}

// Simple date parser
function parseDeadlineDate(input) {
  const cleaned = input.trim().toLowerCase();
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Handle "next [day]"
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
  
  // Handle duration formats: "X days", "X weeks", "X months"
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
  
  // Handle word numbers: "one week", "two weeks", "three months", etc.
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
  
  // Handle MM/DD format (e.g., 04/30, 4/30)
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1]) - 1; // JS months are 0-indexed
    const day = parseInt(slashMatch[2]);
    let year = currentYear;
    
    // If the date has passed this year, assume next year
    const testDate = new Date(year, month, day);
    if (testDate < now) {
      year++;
    }
    
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  // Handle "Mon DD" or "Month DD" format (e.g., Apr 30, April 30, Mar 30)
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
  
  // Handle MM-DD format (e.g., 04-30)
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
  
  // Try parsing as full date string (last resort)
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) {
    return parsed.toISOString().split('T')[0];
  }
  
  return null;
}

module.exports = { handleSetupFlow };