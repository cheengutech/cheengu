// src/services/interpreter.js
// AI fallback layer - ONLY for dates, amounts, durations
// User never talks to AI directly - it just parses messy input silently

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Interprets user input for dates, amounts, durations only
 * Returns { success: true, value: ... } or { success: false, clarification: "..." }
 */
async function interpretInput(userMessage, currentStep) {
  const prompts = {
    awaiting_stake_amount: {
      instruction: `Extract a dollar amount between 5 and 500 from this message.
Return ONLY a JSON object, no other text.
If valid amount: {"success": true, "value": <number>}
If unclear or out of range: {"success": false}`,
      example: `"twenty bucks" → {"success": true, "value": 20}`
    },
    
    awaiting_duration: {
      instruction: `Extract number of days (1-90) from this message. Convert weeks/months to days (1 week = 7, 1 month = 30).
Return ONLY a JSON object, no other text.
If clear: {"success": true, "value": <number of days>}
If unclear: {"success": false}`,
      example: `"a week" → {"success": true, "value": 7}`
    },
    
    awaiting_deadline_date: {
      instruction: `Extract a future date from this message. Today is ${new Date().toISOString().split('T')[0]}.
Return ONLY a JSON object with date in YYYY-MM-DD format, no other text.
Handle: specific dates, relative dates (next friday, end of month), durations (5 weeks, 2 months).
If clear: {"success": true, "value": "YYYY-MM-DD"}
If unclear: {"success": false}`,
      example: `"end of april" → {"success": true, "value": "2026-04-30"}`
    }
  };
  
  const prompt = prompts[currentStep];
  
  if (!prompt) {
    return { success: false };
  }
  
  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `${prompt.instruction}

Example: ${prompt.example}

User message: "${userMessage}"

JSON only:`
        }
      ]
    });
    
    const text = response.content[0].text.trim();
    console.log('🤖 AI response:', text);
    
    try {
      const result = JSON.parse(text);
      return result;
    } catch (parseError) {
      console.error('🤖 AI returned invalid JSON:', text);
      return { success: false };
    }
    
  } catch (error) {
    console.error('🤖 AI interpreter error:', error.message);
    return { success: false };
  }
}

/**
 * Check if input needs AI interpretation
 * Only for dates, amounts, durations - and only if simple parsing failed
 */
function needsInterpretation(input, currentStep) {
  // Only use AI for these specific steps
  if (!['awaiting_stake_amount', 'awaiting_duration', 'awaiting_deadline_date'].includes(currentStep)) {
    return false;
  }
  
  const cleaned = input.trim().toLowerCase();
  
  // If it's just a number, no AI needed
  if (/^\$?\d+$/.test(cleaned.replace('$', ''))) return false;
  
  // If input has letters, might need AI
  return true;
}

module.exports = { interpretInput, needsInterpretation };