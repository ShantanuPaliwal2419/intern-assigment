-- Migration: 0001_init.sql
-- Description: Create initial schema for homes, members, bills, and shares with named constraints.

CREATE TABLE homes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CONSTRAINT chk_homes_name_nonempty CHECK (LENGTH(TRIM(name)) > 0)
);

CREATE TABLE members (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    name TEXT NOT NULL,
    seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    CONSTRAINT chk_members_name_nonempty CHECK (LENGTH(TRIM(name)) > 0),
    CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
    CONSTRAINT uq_members_home_seq UNIQUE (home_id, seq)
);

CREATE TABLE bills (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    title TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    CONSTRAINT chk_bills_title_nonempty CHECK (LENGTH(TRIM(title)) > 0),
    CONSTRAINT chk_bills_total_cents_positive CHECK (total_cents > 0),
    CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    paid_at TEXT,
    idempotency_key TEXT,
    created_at TEXT NOT NULL,
    CONSTRAINT chk_shares_amount_cents_nonneg CHECK (amount_cents >= 0),
    CONSTRAINT chk_shares_payment_state CHECK (
        (paid_at IS NULL AND idempotency_key IS NULL) OR 
        (paid_at IS NOT NULL AND idempotency_key IS NOT NULL)
    ),
    CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    CONSTRAINT uq_shares_bill_member UNIQUE (bill_id, member_id)
);

-- Performance Indexes
CREATE INDEX idx_members_home_seq ON members(home_id, seq);
CREATE INDEX idx_bills_home_id ON bills(home_id, created_at);
CREATE INDEX idx_shares_bill_id ON shares(bill_id);
CREATE INDEX idx_shares_member_unpaid ON shares(member_id) WHERE paid_at IS NULL;
