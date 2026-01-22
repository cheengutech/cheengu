// ============================================================================
// FILE: src/handlers/setup.js
// ============================================================================

const { supabase } = require('../config/database');
const { sendSMS } = require('../services/sms');
const { normalizePhone } = require('../utils/phone');
const { stripe, INITIAL_STAKE } = require('../config/stripe');

async function handleSetupFlow(phone, message) {
  const normalizedPhone = normalizePhone(phone);
  
  // Check if user already exists and is active
  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();
  
  if (existingUser && existingUser.status === 'active') {
    await sendSMS(
      normalizedPhone,
      'You already have an active commitment. Complete it first before starting a new one.'
    );
    return;
  }

  // Get or create setup state
  let { data: setupState } = await supabase
    .from('setup_state')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  if (!setupState && message.toUpperCase() === 'START') {
    await supabase.from('setup_state').insert({
      phone: normalizedPhone,
      current_step: 'awaiting_commitment'
    });
    await sendSMS(normalizedPhone, "What's your fitness commitment for this week?");
    return;
  }

  if (!setupState) {
    await sendSMS(normalizedPhone, 'Text START to begin setting up your accountability commitment.');
    return;
  }

  // Handle setup steps
  if (setupState.current_step === 'awaiting_commitment') {
    await supabase
      .from('setup_state')
      .update({
        temp_commitment: message,
        current_step: 'awaiting_judge_phone'
      })
      .eq('phone', normalizedPhone);
    
    await sendSMS(normalizedPhone, "What's your judge's phone number? (Include area code)");
    return;
  }

  if (setupState.current_step === 'awaiting_judge_phone') {
    const judgePhone = normalizePhone(message);
    
    if (judgePhone === normalizedPhone) {
      await sendSMS(normalizedPhone, "You can't be your own judge. Please provide someone else's phone number.");
      return;
    }

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

    await supabase
      .from('setup_state')
      .update({
        temp_judge_phone: judgePhone,
        current_step: 'awaiting_payment'
      })
      .eq('phone', normalizedPhone);

    const paymentLink = `${process.env.APP_URL}/pay/${paymentIntent.id}`;
    await sendSMS(
      normalizedPhone,
      `You'll stake $${INITIAL_STAKE}. Pay here: ${paymentLink}\n\nAfter payment, your judge will be contacted.`
    );
    return;
  }
}

module.exports = { handleSetupFlow };