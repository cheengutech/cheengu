// ============================================================================
// FILE: src/utils/phone.js
// ============================================================================

function normalizePhone(phone) {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  }
  
  function isValidYesNo(text) {
    const normalized = text.trim().toUpperCase();
    return normalized === 'YES' || normalized === 'NO';
  }
  
  module.exports = { normalizePhone, isValidYesNo };
  