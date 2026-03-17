// ============================================================================
// FILE: src/services/sms.js
// CHEENGU V2: SMS service with AI-powered GIFs
// ============================================================================

const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Search Klipy for a GIF based on a search query
 */
async function searchGif(query) {
  try {
    const response = await fetch(
      `https://api.klipy.com/v1/search?q=${encodeURIComponent(query)}&key=${process.env.KLIPY_API_KEY}&limit=1&media_filter=gif`
    );
    
    if (!response.ok) {
      console.error('❌ Klipy API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const gif = data.results[0].media_formats?.tinygif?.url || 
                  data.results[0].media_formats?.gif?.url ||
                  data.results[0].url;
      return gif;
    }
    
    return null;
  } catch (error) {
    console.error('❌ GIF search failed:', error.message);
    return null;
  }
}

/**
 * Use AI to generate a GIF search query
 */
async function getGifSearchQuery(messageText, context = '') {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Generate a 2-4 word GIF search query for this message in an accountability competition app.

Message: "${messageText}"
Context: ${context || 'competition/game'}

Rules:
- Keep it simple (e.g., "victory celebration", "game over", "you win")
- Match the tone: competitive, sports, gaming
- For wins: trophy, victory, champion, celebration
- For losses: game over, defeated, loser, pay up

Reply with ONLY the search query.`
        }
      ]
    });

    const query = response.content[0].text.trim();
    console.log(`🤖 AI GIF query: "${query}"`);
    return query;
  } catch (error) {
    console.error('❌ AI GIF query failed:', error.message);
    const fallbacks = {
      success: 'victory celebration',
      failure: 'game over loser',
      complete: 'champion trophy',
    };
    return fallbacks[context] || 'competition';
  }
}

/**
 * Send an SMS message
 */
async function sendSMS(to, body, mediaUrl = null) {
  try {
    const messageOptions = {
      body: `cheengu: ${body}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    };

    if (mediaUrl) {
      messageOptions.mediaUrl = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
    }

    const message = await twilioClient.messages.create(messageOptions);
    console.log(`📤 SMS to ${to}: ${body.substring(0, 50)}...${mediaUrl ? ' [+GIF]' : ''}`);
    return message;
  } catch (error) {
    console.error(`❌ SMS failed to ${to}:`, error.message);
    throw error;
  }
}

/**
 * Send SMS with AI-selected GIF
 */
async function sendSMSWithAIGif(to, body, context = '') {
  try {
    const searchQuery = await getGifSearchQuery(body, context);
    const gifUrl = await searchGif(searchQuery);
    
    if (gifUrl) {
      return sendSMS(to, body, gifUrl);
    } else {
      console.log(`⚠️ No GIF found for "${searchQuery}", sending text only`);
      return sendSMS(to, body);
    }
  } catch (error) {
    console.error('❌ sendSMSWithAIGif failed:', error.message);
    return sendSMS(to, body);
  }
}

module.exports = { 
  sendSMS, 
  sendSMSWithAIGif,
  searchGif,
  getGifSearchQuery
};