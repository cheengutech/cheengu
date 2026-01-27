// src/handlers/setup.js

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');
const { stripe, INITIAL_STAKE } = require('../config/stripe');

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

    if (response === 'DAILY') {
      await supabase
        .from('setup_state')
        .update({
          temp_commitment_type: 'daily',
          current_step: 'awaiting_duration'
        })
        .eq('phone', normalizedPhone);
      
      await sendSMS(
        normalizedPhone, 
        `Perfect! Daily check-ins it is.\n\nYour judge will verify every day at 8pm. Each missed day = -$5 from your $20 stake.\n\nHow many days? Reply with a number (Example: 7 for one week, 30 for one month)`
      );
      return;
    } else {
      // DEADLINE type
      await supabase
        .from('setup_state')
        .update({
          temp_commitment_type: 'deadline',
          current_step: 'awaiting_deadline_date'
        })
        .eq('phone', normalizedPhone);
      
      await sendSMS(
        normalizedPhone, 
        `Perfect! One final check-in at your deadline.\n\nYour judge will verify on that date. If you didn't complete it, you lose the full $20 stake.\n\nWhen's your deadline? (Examples: "Jan 31", "2/15", "next Friday")`
      );
      return;
    }
  }

  if (setupState.current_step === 'awaiting_duration') {
    const days = parseInt(message);
    
    if (isNaN(days) || days < 1 || days > 90) {
      await sendSMS(normalizedPhone, 'Please enter a number between 1 and 90 days.');
      return;
    }

    console.log('📆 Duration set:', days, 'days');
    
    await supabase
      .from('setup_state')
      .update({
        temp_deadline_date: days.toString(), // Store as string, will calculate actual end date later
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(
      normalizedPhone, 
      `${days} days of daily check-ins. Got it!\n\nNow, who's your accountability judge? They'll verify your progress.\n\nSend their phone number (include area code):`
    );
    return;
  }

  if (setupState.current_step === 'awaiting_deadline_date') {
    console.log('📆 Processing deadline date:', message);
    
    // Parse date (simple parsing - can be enhanced)
    const parsedDate = parseDeadlineDate(message);
    
    if (!parsedDate) {
      await sendSMS(normalizedPhone, 'Could not understand that date. Please try: Jan 31, 2/15, or next Friday');
      return;
    }

    await supabase
      .from('setup_state')
      .update({
        temp_deadline_date: parsedDate,
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(normalizedPhone, "What's your judge's phone number? (Include area code)");
    return;
  }

  if (setupState.current_step === 'awaiting_judge_phone') {
    console.log('👨‍⚖️ Processing judge phone:', message);
    const judgePhone = normalizePhone(message);
    
    if (judgePhone === normalizedPhone) {
      console.log('⚠️ User tried to be their own judge');
      await sendSMS(normalizedPhone, "You can't be your own judge. Please provide someone else's phone number.");
      return;
    }

    console.log('💳 Creating Stripe payment intent');
    
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: INITIAL_STAKE * 100,
        currency: 'usd',
        metadata: {
          phone: normalizedPhone,
          commitment: setupState.temp_commitment,
          commitment_type: setupState.temp_commitment_type,
          deadline_date: setupState.temp_deadline_date || '',
          judge_phone: judgePhone
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
        `You'll stake $${INITIAL_STAKE}. Pay here: ${paymentLink}\n\nAfter payment, your judge will be contacted.`
      );
    } catch (stripeError) {
      console.error('❌ Stripe error:', stripeError);
      await sendSMS(normalizedPhone, 'Sorry, payment setup failed. Please try again.');
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