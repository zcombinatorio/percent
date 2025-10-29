-- Create proposals table for storing all proposal data
CREATE TABLE IF NOT EXISTS proposals (
  id SERIAL PRIMARY KEY,                      -- Global unique ID
  moderator_id INTEGER NOT NULL,              -- Reference to moderator_state
  proposal_id INTEGER NOT NULL,               -- Per-moderator proposal ID (1, 2, 3...)
  title VARCHAR(255),                         -- Proposal title
  description TEXT,                           -- Proposal description (optional)
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL,
  proposal_length BIGINT NOT NULL,

  -- Transaction data (instructions only)
  transaction_instructions JSONB NOT NULL,
  transaction_fee_payer VARCHAR(64),

  -- Token configuration
  base_mint VARCHAR(64) NOT NULL,
  quote_mint VARCHAR(64) NOT NULL,
  base_decimals INTEGER NOT NULL,
  quote_decimals INTEGER NOT NULL,

  -- AMM configuration
  amm_config JSONB NOT NULL,

  -- TWAP configuration
  twap_config JSONB NOT NULL,

  -- AMM serialized states
  pass_amm_data JSONB,
  fail_amm_data JSONB,

  -- Vault serialized states
  base_vault_data JSONB,
  quote_vault_data JSONB,

  -- TWAP Oracle serialized state
  twap_oracle_data JSONB,

  -- Optional fields
  spot_pool_address VARCHAR(64),
  total_supply BIGINT NOT NULL DEFAULT 1000000000,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique proposal IDs per moderator
  CONSTRAINT unique_moderator_proposal UNIQUE (moderator_id, proposal_id),

  -- Foreign key to moderator
  CONSTRAINT fk_proposals_moderator FOREIGN KEY (moderator_id)
    REFERENCES moderator_state(id) ON DELETE CASCADE
);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at DESC);

-- Create index on moderator_id for filtering by moderator
CREATE INDEX IF NOT EXISTS idx_proposals_moderator ON proposals(moderator_id);

-- Create moderator state table for server restarts
-- Supports multiple moderators, each with their own configuration and proposal counter
CREATE TABLE IF NOT EXISTS moderator_state (
  id SERIAL PRIMARY KEY,
  proposal_id_counter INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL,
  protocol_name VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create price history table for charting
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  market VARCHAR(4) NOT NULL CHECK (market IN ('pass', 'fail', 'spot')),
  price DECIMAL(20, 10) NOT NULL,
  base_liquidity DECIMAL(20, 10),
  quote_liquidity DECIMAL(20, 10)
);

-- Create indexes for price history queries
CREATE INDEX IF NOT EXISTS idx_price_history_moderator_proposal_timestamp
  ON price_history(moderator_id, proposal_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_timestamp
  ON price_history(timestamp DESC);

-- Create TWAP history table
CREATE TABLE IF NOT EXISTS twap_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  pass_twap DECIMAL(20, 10) NOT NULL,
  fail_twap DECIMAL(20, 10) NOT NULL,
  pass_aggregation DECIMAL(20, 10) NOT NULL,
  fail_aggregation DECIMAL(20, 10) NOT NULL
);

-- Create indexes for TWAP history queries
CREATE INDEX IF NOT EXISTS idx_twap_history_moderator_proposal_timestamp
  ON twap_history(moderator_id, proposal_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_twap_history_timestamp
  ON twap_history(timestamp DESC);

-- Create trade history table
CREATE TABLE IF NOT EXISTS trade_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  market VARCHAR(4) NOT NULL CHECK (market IN ('pass', 'fail')),
  user_address VARCHAR(64) NOT NULL,
  is_base_to_quote BOOLEAN NOT NULL,
  amount_in DECIMAL(20, 10) NOT NULL,
  amount_out DECIMAL(20, 10) NOT NULL,
  price DECIMAL(20, 10) NOT NULL,
  tx_signature VARCHAR(128)
);

-- Create indexes for trade history queries
CREATE INDEX IF NOT EXISTS idx_trade_history_moderator_proposal_timestamp
  ON trade_history(moderator_id, proposal_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trade_history_user
  ON trade_history(user_address);
CREATE INDEX IF NOT EXISTS idx_trade_history_timestamp
  ON trade_history(timestamp DESC);

-- Add update trigger for proposals updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_proposals_updated_at 
  BEFORE UPDATE ON proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_moderator_state_updated_at
  BEFORE UPDATE ON moderator_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to notify WebSocket clients of new prices
CREATE OR REPLACE FUNCTION notify_new_price()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('new_price', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on price_history inserts for real-time WebSocket updates
CREATE TRIGGER price_notification_trigger
  AFTER INSERT ON price_history
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_price();