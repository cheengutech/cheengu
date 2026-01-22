// ============================================================================
// FILE: src/utils/timezone.js
// ============================================================================

const moment = require('moment-timezone');

function getUserHour(timezone) {
  return moment().tz(timezone).hour();
}

function getTodayDate(timezone) {
  return moment().tz(timezone).format('YYYY-MM-DD');
}

module.exports = { getUserHour, getTodayDate };