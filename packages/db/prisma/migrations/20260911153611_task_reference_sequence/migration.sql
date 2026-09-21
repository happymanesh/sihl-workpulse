-- Human-facing task references (WP-000042).
--
-- A sequence rather than a count(*) or max()+1: those race under concurrent
-- creation and would hand two tasks the same number. Task.reference carries a
-- unique constraint as the backstop, but the sequence is what stops the clash
-- happening in the first place.
--
-- IF NOT EXISTS so re-running against an existing database is safe.
CREATE SEQUENCE IF NOT EXISTS task_reference_seq START WITH 1 INCREMENT BY 1;
