// ============================================================================
// FILE: src/handlers/stripe-webhook.js
// ============================================================================

const { stripe } = require('../config/stripe');
const { finalizeSetup } = require('./payment');

async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    await finalizeSetup(paymentIntent.metadata.phone);
  }

  res.status(200).send({ received: true });
}

module.exports = stripeWebhook;
