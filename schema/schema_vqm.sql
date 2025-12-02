-- Quantum Markets schema with qm_ prefix
-- Supports 2-4 markets per proposal instead of binary pass/fail

-- Moderators table
CREATE TABLE IF NOT EXISTS qm_moderators (
  id SERIAL PRIMARY KEY,
  proposal_id_counter INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL,
  protocol_name VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proposals table
CREATE TABLE IF NOT EXISTS qm_proposals (
  id SERIAL PRIMARY KEY,
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL,
  proposal_length BIGINT NOT NULL,

  base_mint VARCHAR(64) NOT NULL,
  quote_mint VARCHAR(64) NOT NULL,
  base_decimals INTEGER NOT NULL,
  quote_decimals INTEGER NOT NULL,

  -- Quantum markets fields
  markets INTEGER NOT NULL CHECK (markets >= 2 AND markets <= 8),
  market_labels TEXT[],

  amm_config JSONB NOT NULL,
  twap_config JSONB NOT NULL,

  -- Array of AMM data instead of separate pass/fail
  amm_data JSONB NOT NULL,
  base_vault_data JSONB,
  quote_vault_data JSONB,
  twap_oracle_data JSONB,

  spot_pool_address VARCHAR(64),
  total_supply BIGINT NOT NULL DEFAULT 1000000000,
  has_withdrawal BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_qm_moderator_proposal UNIQUE (moderator_id, proposal_id),
  CONSTRAINT fk_qm_proposals_moderator FOREIGN KEY (moderator_id)
    REFERENCES qm_moderators(id) ON DELETE CASCADE
);

-- Indexes for proposals
CREATE INDEX IF NOT EXISTS idx_qm_proposals_moderator_status ON qm_proposals(moderator_id, status);
CREATE INDEX IF NOT EXISTS idx_qm_proposals_moderator_created ON qm_proposals(moderator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qm_proposals_moderator_proposal ON qm_proposals(moderator_id, proposal_id);
CREATE INDEX IF NOT EXISTS idx_qm_proposals_has_withdrawal ON qm_proposals(moderator_id, has_withdrawal)
  WHERE has_withdrawal = true;

-- Price history table
CREATE TABLE IF NOT EXISTS qm_price_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  market INTEGER NOT NULL CHECK (market >= -1),  -- -1 for spot, 0+ for market index
  price DECIMAL(20, 10) NOT NULL,

  CONSTRAINT fk_qm_price_history_moderator FOREIGN KEY (moderator_id)
    REFERENCES qm_moderators(id) ON DELETE CASCADE,
  CONSTRAINT fk_qm_price_history_proposal FOREIGN KEY (moderator_id, proposal_id)
    REFERENCES qm_proposals(moderator_id, proposal_id) ON DELETE CASCADE
);

-- Index for price history
CREATE INDEX IF NOT EXISTS idx_qm_price_history_moderator_proposal_timestamp
  ON qm_price_history(moderator_id, proposal_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_qm_price_history_moderator_proposal_market
  ON qm_price_history(moderator_id, proposal_id, market);

-- TWAP history table
CREATE TABLE IF NOT EXISTS qm_twap_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  twaps DECIMAL(20, 10)[] NOT NULL,          -- Array of TWAPs for each market
  aggregations DECIMAL(20, 10)[] NOT NULL,   -- Array of aggregations for each market

  CONSTRAINT fk_qm_twap_history_moderator FOREIGN KEY (moderator_id)
    REFERENCES qm_moderators(id) ON DELETE CASCADE,
  CONSTRAINT fk_qm_twap_history_proposal FOREIGN KEY (moderator_id, proposal_id)
    REFERENCES qm_proposals(moderator_id, proposal_id) ON DELETE CASCADE
);

-- Index for TWAP history
CREATE INDEX IF NOT EXISTS idx_qm_twap_history_moderator_proposal_timestamp
  ON qm_twap_history(moderator_id, proposal_id, timestamp DESC);

-- Trade history table
CREATE TABLE IF NOT EXISTS qm_trade_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  market INTEGER NOT NULL CHECK (market >= 0),  -- Market index (0+)
  user_address VARCHAR(64) NOT NULL,
  is_base_to_quote BOOLEAN NOT NULL,
  amount_in DECIMAL(20, 10) NOT NULL,
  amount_out DECIMAL(20, 10) NOT NULL,
  price DECIMAL(20, 10) NOT NULL,
  tx_signature VARCHAR(128),

  CONSTRAINT fk_qm_trade_history_moderator FOREIGN KEY (moderator_id)
    REFERENCES qm_moderators(id) ON DELETE CASCADE,
  CONSTRAINT fk_qm_trade_history_proposal FOREIGN KEY (moderator_id, proposal_id)
    REFERENCES qm_proposals(moderator_id, proposal_id) ON DELETE CASCADE
);

-- Index for trade history
CREATE INDEX IF NOT EXISTS idx_qm_trade_history_moderator_proposal_timestamp
  ON qm_trade_history(moderator_id, proposal_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_qm_trade_history_moderator_proposal_market
  ON qm_trade_history(moderator_id, proposal_id, market);

-- Update trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update triggers
CREATE TRIGGER update_qm_proposals_updated_at
  BEFORE UPDATE ON qm_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_qm_moderators_updated_at
  BEFORE UPDATE ON qm_moderators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- WebSocket notification for prices
CREATE OR REPLACE FUNCTION notify_qm_new_price()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('qm_new_price', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qm_price_notification_trigger
  AFTER INSERT ON qm_price_history
  FOR EACH ROW
  EXECUTE FUNCTION notify_qm_new_price();

-- WebSocket notification for trades
CREATE OR REPLACE FUNCTION notify_qm_new_trade()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('new_trade', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qm_trade_notification_trigger
  AFTER INSERT ON qm_trade_history
  FOR EACH ROW
  EXECUTE FUNCTION notify_qm_new_trade();

-- Proposal withdrawals table
CREATE TABLE IF NOT EXISTS qm_proposal_withdrawals (
  id SERIAL PRIMARY KEY,
  moderator_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  withdrawal_request_id VARCHAR(128) NOT NULL,
  withdrawal_signature VARCHAR(128) NOT NULL,
  withdrawal_percentage INTEGER NOT NULL,
  withdrawn_token_a VARCHAR(64) NOT NULL,
  withdrawn_token_b VARCHAR(64) NOT NULL,
  spot_price DECIMAL(20, 10) NOT NULL,
  needs_deposit_back BOOLEAN NOT NULL DEFAULT TRUE,
  deposit_signature VARCHAR(128),
  deposited_token_a VARCHAR(64),
  deposited_token_b VARCHAR(64),
  deposited_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  pool_address VARCHAR(64) NOT NULL,

  CONSTRAINT fk_qm_proposal_withdrawals_moderator FOREIGN KEY (moderator_id)
    REFERENCES qm_moderators(id) ON DELETE CASCADE,
  CONSTRAINT fk_qm_proposal_withdrawals_proposal FOREIGN KEY (moderator_id, proposal_id)
    REFERENCES qm_proposals(moderator_id, proposal_id) ON DELETE CASCADE,
  CONSTRAINT unique_qm_withdrawal_request UNIQUE (withdrawal_request_id)
);

-- Index for proposal withdrawals
CREATE INDEX IF NOT EXISTS idx_qm_proposal_withdrawals_needs_deposit
  ON qm_proposal_withdrawals(moderator_id, needs_deposit_back)
  WHERE needs_deposit_back = true;

-- Update trigger for proposal withdrawals
CREATE TRIGGER update_qm_proposal_withdrawals_updated_at
  BEFORE UPDATE ON qm_proposal_withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();