// src/services/interpreter.js
// AI fallback layer - extracts structured data from messy user input
// User never talks to AI directly - it just parses their intent silently

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Interprets user input and extracts structured data based on current step
 * Returns { success: true, value: ... } or { success: false, clarification: "..." }
 */
async function interpretInput(userMessage, currentStep, context = {}) {
  const prompts = {
    awaiting_commitment: {
      instruction: `Extract a commitment/goal from this message. Return ONLY a JSON object.
If clear commitment: {"success": true, "value": "<the commitment>"}
If unclear: {"success": false, "clarification": "What do you want to commit to? (e.g., Exercise daily, Finish my project)"}`,
      example: `"i wanna workout more" → {"success": true, "value": "workout more"}`
    },
    
    awaiting_commitment_type: {
      instruction: `Determine if user wants DAILY check-ins or a one-time DEADLINE.
Return ONLY a JSON object.
If daily/recurring/habit/everyday: {"success": true, "value": "daily"}
If deadline/one-time/by date/finish by: {"success": true, "value": "deadline"}
If unclear: {"success": false, "clarification": "Should I check in DAILY or just once at a DEADLINE?\\n\\nReply 1 for Daily or 2 for Deadline"}`,
      example: `"every day" → {"success": true, "value": "daily"}`
    },
    
    awaiting_stake_amount: {
      instruction: `Extract a dollar amount between 5 and 500 from this message.
Return ONLY a JSON object.
If valid amount: {"success": true, "value": <number>}
If unclear or out of range: {"success": false, "clarification": "Please enter an amount between $5 and $500."}`,
      example: `"twenty bucks" → {"success": true, "value": 20}`
    },
    
    awaiting_duration: {
      instruction: `Extract number of days (1-90) from this message. Convert weeks/months to days.
Return ONLY a JSON object.
If clear: {"success": true, "value": <number of days>}
If unclear: {"success": false, "clarification": "How many days? (1-90, or try '2 weeks')"}`,
      example: `"a week" → {"success": true, "value": 7}, "two weeks" → {"success": true, "value": 14}`
    },
    
    awaiting_deadline_date: {
      instruction: `Extract a future date from this message. Today is ${new Date().toISOString().split('T')[0]}.
Return ONLY a JSON object with date in YYYY-MM-DD format.
Handle: specific dates, relative dates (next friday, end of month), durations (5 weeks, 2 months).
If clear: {"success": true, "value": "YYYY-MM-DD"}
If unclear: {"success": false, "clarification": "When's your deadline? (e.g., Apr 30, 5 weeks, next Friday)"}`,
      example: `"end of april" → {"success": true, "value": "2026-04-30"}`
    },
    
    awaiting_judge_phone: {
      instruction: `Extract a name and phone number from this message.
Return ONLY a JSON object.
If both found: {"success": true, "value": {"name": "<name>", "phone": "<10-digit phone>"}}
If unclear: {"success": false, "clarification": "Send their name and number:\\n(e.g., Mike 555-123-4567)"}`,
      example: `"my buddy john 5551234567" → {"success": true, "value": {"name": "John", "phone": "5551234567"}}`
    },
    
    judge_verification: {
      instruction: `Determine if this is a YES or NO response.
Return ONLY a JSON object.
Yes indicators: yes, yep, yeah, yup, correct, did it, completed, done, y, 1
No indicators: no, nope, nah, didn't, failed, missed, n, 0
If clear: {"success": true, "value": "YES"} or {"success": true, "value": "NO"}
If unclear: {"success": false, "clarification": "Reply YES or NO only."}`,
      example: `"yep he did" → {"success": true, "value": "YES"}`
    },
    
    command_detection: {
      instruction: `Detect if user is trying to use a command or needs help.
Commands: START, STATUS, HISTORY, HOW, MENU, RESET, UNDO
Return ONLY a JSON object.
If command detected: {"success": true, "value": "<COMMAND>"}
If asking for help/confused: {"success": true, "value": "HOW"}
If not a command: {"success": false, "clarification": null}`,
      example: `"whats my progress" → {"success": true, "value": "STATUS"}`
    }
  };
  
  const prompt = prompts[currentStep];
  
  if (!prompt) {
    return { success: false, clarification: "Something went wrong. Text HOW for help." };
  }
  
  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307', // Fast and cheap
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `${prompt.instruction}

Example: ${prompt.example}

User message: "${userMessage}"

Return ONLY valid JSON, no other text.`
        }
      ]
    });
    
    const text = response.content[0].text.trim();
    
    // Parse the JSON response
    try {
      const result = JSON.parse(text);
      return result;
    } catch (parseError) {
      console.error('AI returned invalid JSON:', text);
      return { success: false, clarification: getDefaultClarification(currentStep) };
    }
    
  } catch (error) {
    console.error('AI interpreter error:', error);
    // Fall back to default clarification
    return { success: false, clarification: getDefaultClarification(currentStep) };
  }
}

function getDefaultClarification(step) {
  const defaults = {
    awaiting_commitment: "What do you want to commit to?",
    awaiting_commitment_type: "Reply 1 for Daily check-ins or 2 for Deadline",
    awaiting_stake_amount: "Enter an amount between $5 and $500",
    awaiting_duration: "How many days? (1-90)",
    awaiting_deadline_date: "When's your deadline? (e.g., Apr 30 or 5 weeks)",
    awaiting_judge_phone: "Send their name and number (e.g., Mike 555-123-4567)",
    judge_verification: "Reply YES or NO only.",
    command_detection: "Text HOW for available commands."
  };
  
  return defaults[step] || "Text HOW for help.";
}

/**
 * Quick check if input might need AI interpretation
 * Returns true if input seems non-standard
 */
function needsInterpretation(input, currentStep) {
  const cleaned = input.trim().toLowerCase();
  
  // If it's a clear command, no AI needed
  const commands = ['start', 'status', 'history', 'how', 'menu', 'reset', 'undo', 'yes', 'no', 'accept', 'decline'];
  if (commands.includes(cleaned)) return false;
  
  // If it's just a number for stake/duration, no AI needed
  if (['awaiting_stake_amount', 'awaiting_duration'].includes(currentStep)) {
    if (/^\$?\d+$/.test(cleaned.replace('$', ''))) return false;
  }
  
  // If it's a simple 1 or 2 for commitment type, no AI needed
  if (currentStep === 'awaiting_commitment_type') {
    if (['1', '2', 'daily', 'deadline'].includes(cleaned)) return false;
  }
  
  // Otherwise, might need AI help
  return true;
}

module.exports = { interpretInput, needsInterpretation };