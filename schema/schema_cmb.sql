-- Zcombinator/Futarchy schema with cmb_ prefix
-- For tracking price/TWAP/trade history of futarchy proposals
-- Uses zcombinator dao.id directly (no FK to qm_moderators)

-- Price history for futarchy proposals
CREATE TABLE IF NOT EXISTS cmb_price_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dao_id INTEGER NOT NULL,        -- zcombinator dao.id directly
  proposal_id INTEGER NOT NULL,   -- on-chain proposal ID
  market INTEGER NOT NULL,        -- pool index (0, 1, 2, ...)
  price DECIMAL(20, 10) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cmb_price_history_dao_proposal_timestamp
  ON cmb_price_history(dao_id, proposal_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_cmb_price_history_dao_proposal_market
  ON cmb_price_history(dao_id, proposal_id, market);

-- TWAP history for futarchy proposals
CREATE TABLE IF NOT EXISTS cmb_twap_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dao_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  twaps DECIMAL(20, 10)[] NOT NULL,        -- Array of TWAPs for each market
  aggregations DECIMAL(20, 10)[] NOT NULL  -- Array of cumulative observations
);

CREATE INDEX IF NOT EXISTS idx_cmb_twap_history_dao_proposal_timestamp
  ON cmb_twap_history(dao_id, proposal_id, timestamp DESC);

-- Trade history for futarchy proposals
CREATE TABLE IF NOT EXISTS cmb_trade_history (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dao_id INTEGER NOT NULL,
  proposal_id INTEGER NOT NULL,
  market INTEGER NOT NULL,
  user_address VARCHAR(64) NOT NULL,
  is_base_to_quote BOOLEAN NOT NULL,
  amount_in DECIMAL(20, 10) NOT NULL,
  amount_out DECIMAL(20, 10) NOT NULL,
  price DECIMAL(20, 10) NOT NULL,
  tx_signature VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_cmb_trade_history_dao_proposal_timestamp
  ON cmb_trade_history(dao_id, proposal_id, timestamp DESC);

-- WebSocket notification for prices
CREATE OR REPLACE FUNCTION notify_cmb_new_price()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('cmb_new_price', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cmb_price_notification_trigger ON cmb_price_history;
CREATE TRIGGER cmb_price_notification_trigger
  AFTER INSERT ON cmb_price_history
  FOR EACH ROW
  EXECUTE FUNCTION notify_cmb_new_price();

-- WebSocket notification for trades
CREATE OR REPLACE FUNCTION notify_cmb_new_trade()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('cmb_new_trade', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cmb_trade_notification_trigger ON cmb_trade_history;
CREATE TRIGGER cmb_trade_notification_trigger
  AFTER INSERT ON cmb_trade_history
  FOR EACH ROW
  EXECUTE FUNCTION notify_cmb_new_trade();
