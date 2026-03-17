// src/services/sms.js

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
 * @param {string} query - Search term
 * @returns {string|null} - GIF URL or null
 */
async function searchGif(query) {
  try {
    // Klipy API (drop-in replacement for Tenor, run by ex-Tenor team)
    const response = await fetch(
      `https://api.klipy.com/v1/search?q=${encodeURIComponent(query)}&key=${process.env.KLIPY_API_KEY}&limit=1&media_filter=gif`
    );
    
    if (!response.ok) {
      console.error('❌ Klipy API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      // Get the GIF URL (use smaller format for MMS)
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
 * Use AI to generate a GIF search query based on message content
 * @param {string} messageText - The SMS message being sent
 * @param {string} context - Additional context (e.g., 'success', 'failure', 'reminder')
 * @returns {string} - Search query for GIF
 */
async function getGifSearchQuery(messageText, context = '') {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `You are a GIF search assistant for an accountability app with a drill sergeant personality. 

Given this message being sent to a user, generate a SHORT (2-4 words) search query to find a relevant, motivational GIF.

Message: "${messageText}"
Context: ${context || 'general accountability message'}

Rules:
- Keep it simple and searchable (e.g., "drill sergeant yelling", "celebration dance", "disappointed coach")
- Match the tone: tough love, military, sports coaching, motivation
- For success: victory, celebration, salute, proud
- For failure: disappointed, facepalm, do better, try again
- For reminders: wake up, get moving, clock ticking
- Avoid anything offensive or inappropriate

Reply with ONLY the search query, nothing else.`
        }
      ]
    });

    const query = response.content[0].text.trim();
    console.log(`🤖 AI GIF query for "${messageText.substring(0, 30)}...": "${query}"`);
    return query;
  } catch (error) {
    console.error('❌ AI GIF query failed:', error.message);
    // Fallback queries based on context
    const fallbacks = {
      success: 'thumbs up celebration',
      failure: 'disappointed coach',
      reminder: 'drill sergeant',
      welcome: 'military salute',
      complete: 'victory dance',
      reengagement: 'waiting impatiently'
    };
    return fallbacks[context] || 'motivation drill sergeant';
  }
}

/**
 * Send an SMS message (no GIF)
 * @param {string} to - Recipient phone number
 * @param {string} body - Message text
 * @param {string|string[]} [mediaUrl] - Optional URL(s) to GIF/image for MMS
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
    console.log(`📤 SMS sent to ${to}: ${body.substring(0, 50)}...${mediaUrl ? ' [+GIF]' : ''}`);
    return message;
  } catch (error) {
    console.error(`❌ SMS failed to ${to}:`, error.message);
    throw error;
  }
}

/**
 * Send an SMS with an AI-selected GIF based on message content
 * @param {string} to - Recipient phone number
 * @param {string} body - Message text
 * @param {string} [context] - Context hint ('success', 'failure', 'reminder', 'welcome', 'complete', 'reengagement')
 */
async function sendSMSWithAIGif(to, body, context = '') {
  try {
    // Get AI-generated search query
    const searchQuery = await getGifSearchQuery(body, context);
    
    // Search for GIF
    const gifUrl = await searchGif(searchQuery);
    
    if (gifUrl) {
      return sendSMS(to, body, gifUrl);
    } else {
      // Fall back to text-only if no GIF found
      console.log(`⚠️ No GIF found for "${searchQuery}", sending text only`);
      return sendSMS(to, body);
    }
  } catch (error) {
    console.error('❌ sendSMSWithAIGif failed:', error.message);
    // Fall back to text-only
    return sendSMS(to, body);
  }
}

/**
 * Send SMS with a specific GIF URL (no AI)
 * @param {string} to - Recipient phone number
 * @param {string} body - Message text
 * @param {string} gifUrl - Direct URL to GIF
 */
async function sendSMSWithGif(to, body, gifUrl) {
  return sendSMS(to, body, gifUrl);
}

module.exports = { 
  sendSMS, 
  sendSMSWithAIGif, 
  sendSMSWithGif,
  searchGif,
  getGifSearchQuery
};