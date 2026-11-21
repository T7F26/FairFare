CREATE TABLE IF NOT EXISTS fare_change_statuses (
  agency_id VARCHAR(100) NOT NULL REFERENCES agencies(agency_id),
  fare_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('approved', 'waiting')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agency_id, fare_id)
);