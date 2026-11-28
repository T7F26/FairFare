
-- Issue #47: Edit Discount Change Log
-- Story A11: Edit Discount
-- Records changes to agency discount percentages.

-- 1. Create a table to store discount changes.
CREATE TABLE IF NOT EXISTS discount_change_log (
    log_id SERIAL PRIMARY KEY,
    agency_id VARCHAR(100) NOT NULL,
    category_id INTEGER NOT NULL,
    old_discount NUMERIC(5,2),
    new_discount NUMERIC(5,2),
    changed_by TEXT NOT NULL DEFAULT CURRENT_USER,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create a function to record changes.
CREATE OR REPLACE FUNCTION log_discount_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only record when the discount changes.
    IF OLD.discount_percentage IS DISTINCT FROM
       NEW.discount_percentage THEN

        INSERT INTO discount_change_log (
            agency_id,
            category_id,
            old_discount,
            new_discount,
            changed_by,
            changed_at
        )
        VALUES (
            NEW.agency_id,
            NEW.category_id,
            OLD.discount_percentage,
            NEW.discount_percentage,
            COALESCE(
                NULLIF(
                    CURRENT_SETTING('app.user_id', true),
                    ''
                ),
                CURRENT_USER
            ),
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create a trigger for discount updates.
DROP TRIGGER IF EXISTS
    trg_discount_change ON agency_discounts;

CREATE TRIGGER trg_discount_change
AFTER UPDATE OF discount_percentage
ON agency_discounts
FOR EACH ROW
EXECUTE FUNCTION log_discount_change();

-- 4. View the discount change history.
-- Run this query after making a discount change.
SELECT
    log_id,
    agency_id,
    category_id,
    old_discount,
    new_discount,
    changed_by,
    changed_at
FROM discount_change_log
ORDER BY changed_at DESC;
