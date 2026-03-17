// ============================================================================
// FILE: src/config/database.js
// CHEENGU V2: Supabase connection
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = { supabase };