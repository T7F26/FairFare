-- Remembers which agency the upload waiting in the staging tables belongs to.
-- Only one row: a new upload replaces the previous pending one.
-- Used by GET /api/admin/fare-changes (#23) and Publish (#33).
-- Please run agencies.sql first.
CREATE TABLE IF NOT EXISTS pending_import (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    agency_id VARCHAR(100) NOT NULL REFERENCES agencies(agency_id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
