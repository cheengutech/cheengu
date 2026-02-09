// src/handlers/setup.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');
const { stripe } = require('../config/stripe');

async function handleSetupFlow(phone, message) {
  console.log('🔧 handleSetupFlow called with:', phone, message);
  
  const normalizedPhone = normalizePhone(phone);
  console.log('📞 Normalized phone:', normalizedPhone);
  
  // Check if user already exists and is active
  const { data: existingUser, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();
  
  console.log('👤 Existing user check:', existingUser, userError);
  
  if (existingUser && existingUser.status === 'active') {
    console.log('⚠️ User already has active commitment');
    await sendSMS(
      normalizedPhone,
      'You already have an active commitment. Complete it first before starting a new one.'
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

  if (!setupState && message.toUpperCase() === 'START') {
    console.log('✨ Creating new setup state');
    const { data: newState, error: insertError } = await supabase
      .from('setup_state')
      .insert({
        phone: normalizedPhone,
        current_step: 'awaiting_commitment'
      })
      .select()
      .single();
    
    console.log('📝 New setup state created:', newState, insertError);
    
    if (insertError) {
      console.error('❌ Error creating setup state:', insertError);
      await sendSMS(normalizedPhone, 'Sorry, something went wrong. Please try again.');
      return;
    }
    
    await sendSMS(normalizedPhone, "What's your commitment?\n\nExamples:\n• \"Do 50 pushups daily\"\n• \"Launch my landing page by Feb 1\"\n• \"No alcohol for 30 days\"");
    return;
  }

  if (!setupState) {
    console.log('💬 No setup state, sending START prompt');
    await sendSMS(normalizedPhone, 'Text START to begin setting up your accountability commitment.');
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
      `${days} days - locked in! Each missed day = -$${penalty}.\n\nNow, who's going to keep you honest? Send your judge's phone number (with area code):`
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
    
    await sendSMS(normalizedPhone, `Deadline set! 📅\n\nNow, who's going to keep you honest? Send your judge's phone number (with area code):`);
    return;
  }

  if (setupState.current_step === 'awaiting_judge_phone') {
    console.log('👨‍⚖️ Processing judge phone:', message);
    const judgePhone = normalizePhone(message);
    
    if (judgePhone === normalizedPhone) {
      console.log('⚠️ User tried to be their own judge');
      await sendSMS(normalizedPhone, "Nice try 😄 You can't be your own judge. Who else can hold you accountable?");
      return;
    }

    console.log('💳 Creating Stripe payment intent');
    
    const stakeAmount = setupState.temp_stake_amount || 20;
    const penaltyAmount = setupState.temp_penalty_amount || 5;
    
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: stakeAmount * 100,
        currency: 'usd',
        metadata: {
          phone: normalizedPhone,
          commitment: setupState.temp_commitment,
          commitment_type: setupState.temp_commitment_type,
          deadline_date: setupState.temp_deadline_date || '',
          judge_phone: judgePhone,
          stake_amount: stakeAmount.toString(),
          penalty_amount: penaltyAmount.toString()
        }
      });

      console.log('✅ Payment intent created:', paymentIntent.id);

      await supabase
        .from('setup_state')
        .update({
          temp_judge_phone: judgePhone,
          current_step: 'awaiting_payment'
        })
        .eq('phone', normalizedPhone);

      console.log('✅ Updated to awaiting_payment');

      const paymentLink = `${process.env.APP_URL}/pay/${paymentIntent.id}`;
      console.log('🔗 Payment link:', paymentLink);
      
      await sendSMS(
        normalizedPhone,
        `Almost there! Stake your $${stakeAmount} to lock it in:\n\n${paymentLink}\n\nOnce paid, we'll reach out to your judge.`
      );
    } catch (stripeError) {
      console.error('❌ Stripe error:', stripeError);
      await sendSMS(normalizedPhone, 'Sorry, something went wrong setting up payment. Please try again.');
    }
    return;
  }
  
  console.log('⚠️ Unexpected state:', setupState.current_step);
}

// Simple date parser
function parseDeadlineDate(input) {
  const cleaned = input.trim().toLowerCase();
  const now = new Date();
  
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
  
  // Try parsing as date
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) {
    return parsed.toISOString().split('T')[0];
  }
  
  return null;
}

module.exports = { handleSetupFlow };