
// ============================================================================
// FILE: README.md
// ============================================================================

# Cheengu - SMS Accountability System

A minimalist SMS-based accountability system that makes honesty unavoidable through human verification.

## How It Works

1. **User commits** to a weekly fitness goal and stakes $20
2. **Judge accepts** - a friend who will verify daily claims via SMS
3. **Daily check-in** - User claims YES/NO at 8pm local time
4. **Human verification** - Judge verifies each claim
5. **Consequences** - Each failure costs $5 (paid to judge)

## Setup

### Prerequisites
- Node.js 18+
- Twilio account
- Supabase account
- Stripe account

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/cheengu.git
cd cheengu

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env

# Set up database
npm run setup-db
```

### Configuration

1. **Twilio**: Set up webhook pointing to `https://yourapp.com/sms`
2. **Stripe**: Set up webhook for `payment_intent.succeeded` pointing to `https://yourapp.com/stripe-webhook`
3. **Deploy**: Deploy to your preferred hosting (Heroku, Railway, etc.)

### Running Locally

```bash
npm run dev
```

## Usage

Text "START" to your Cheengu number to begin setup.

## Architecture

- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **SMS**: Twilio
- **Payments**: Stripe
- **Scheduling**: node-cron

## Design Principles

- No AI interpretation (binary YES/NO only)
- No gamification (no streaks, badges, or softening)
- Human accountability (judge verification required)
- Unavoidable honesty (lying has social + financial cost)

## License

MIT