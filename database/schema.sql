// ============================================================================
// FILE: database/schema.sql
// ============================================================================

-- Cheengu Database Schema

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  commitment_text TEXT,
  judge_phone TEXT,
  stake_remaining DECIMAL DEFAULT 20.00,
  timezone TEXT DEFAULT 'America/New_York',
  status TEXT DEFAULT 'setup_pending', 
  -- Status: setup_pending, awaiting_judge, active, completed, cancelled
  commitment_start_date DATE,
  commitment_end_date DATE,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE judges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  consent_status TEXT DEFAULT 'pending', 
  -- Status: pending, accepted, declined
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  date DATE NOT NULL,
  user_claimed BOOLEAN,
  judge_verified BOOLEAN,
  outcome TEXT, 
  -- Outcome: pass, fail, pending
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_phone TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  user_id UUID REFERENCES users(id),
  reason TEXT,
  paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE setup_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  current_step TEXT, 
  -- Steps: awaiting_commitment, awaiting_judge_phone, awaiting_payment
  temp_commitment TEXT,
  temp_judge_phone TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_judges_phone ON judges(phone);
CREATE INDEX idx_daily_logs_user_date ON daily_logs(user_id, date);
CREATE INDEX idx_payouts_unpaid ON payouts(paid) WHERE paid = false;
