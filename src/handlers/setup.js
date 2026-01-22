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
    
    await sendSMS(normalizedPhone, "What's your fitness commitment for this week?");
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
    const { error: updateError } = await supabase
      .from('setup_state')
      .update({
        temp_commitment: message,
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    console.log('✅ Updated to awaiting_judge_phone', updateError);
    
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
      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: INITIAL_STAKE * 100,
        currency: 'usd',
        metadata: {
          phone: normalizedPhone,
          commitment: setupState.temp_commitment,
          judge_phone: judgePhone
        }
      });

      console.log('✅ Payment intent created:', paymentIntent.id);

      const { error: updateError } = await supabase
        .from('setup_state')
        .update({
          temp_judge_phone: judgePhone,
          current_step: 'awaiting_payment'
        })
        .eq('phone', normalizedPhone);

      console.log('✅ Updated to awaiting_payment', updateError);

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

module.exports = { handleSetupFlow };