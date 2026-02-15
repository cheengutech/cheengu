// ============================================================================
// FILE: src/handlers/stripe-webhook.js
// ============================================================================

const { stripe } = require('../config/stripe');
const { finalizeSetup } = require('./payment');

async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Handle both Buffer and string body
    let payload = req.body;
    if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      // Body was already parsed as JSON - stringify it back
      // This is a workaround but not ideal for signature verification
      console.log('⚠️ Warning: Body was pre-parsed as JSON');
      payload = JSON.stringify(payload);
    }
    
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('✅ Stripe webhook verified:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log('💰 Payment succeeded:', paymentIntent.id);
    console.log('📱 Phone from metadata:', paymentIntent.metadata?.phone);
    // Pass the full payment intent so we can store ID and extract metadata
    await finalizeSetup(paymentIntent.metadata.phone, paymentIntent);
  }

  res.status(200).send({ received: true });
}

module.exports = stripeWebhook;