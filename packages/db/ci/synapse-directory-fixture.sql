-- Minimal stand-in for Synapse's user directory, for CI only.
--
-- workPulse never owns this schema: Synapse does, and in every real
-- environment SYNAPSE_DATABASE_URL points at Synapse's own database through a
-- SELECT-only role. This file exists so CI can exercise the federated identity
-- path for real - session verification, the live active-user check, Synapse
-- role to workPulse role mapping, and the deny-by-default for unmapped roles -
-- instead of skipping every test that depends on it.
--
-- Only the three tables and the exact columns SynapseDirectoryService reads are
-- reproduced. If that service starts reading another column, this fixture must
-- gain it, and the e2e suite will say so loudly rather than silently skipping.
--
-- The uids and role codes mirror the real development directory, because
-- apps/api/test/synapse-auth.e2e-spec.ts pins them:
--     uid 1 -> SUPPORT_DESK (maps to EMPLOYEE)
--     uid 2 -> ADMIN        (maps to SYSTEM_ADMIN)
--     uid 8 -> CLIENT_SELF  (deliberately unmapped - an external client)
--
-- Emails are synthetic and match the mock Frappe HR employees, so the
-- user-to-employee link resolves the same way it does locally. No real
-- person's address belongs in a tracked fixture.

CREATE TABLE IF NOT EXISTS role_master (
  role_code       TEXT PRIMARY KEY,
  role_name       TEXT NOT NULL,
  company_code    TEXT,
  hierarchy_code  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS user_details (
  uid        INTEGER PRIMARY KEY,
  username   TEXT NOT NULL,
  full_name  TEXT NOT NULL,
  email      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS user_role_map (
  id         SERIAL PRIMARY KEY,
  user_uid   INTEGER NOT NULL,
  role_code  TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- The five roles Synapse actually has. CLIENT_SELF is included precisely
-- because it must never map to a workPulse role: RoleMapService refuses it, and
-- the e2e suite proves that refusal against a directory that really contains it.
INSERT INTO role_master (role_code, role_name, company_code, hierarchy_code, is_active) VALUES
  ('ADMIN',        'Super Admin',          'SIHL', '9999', TRUE),
  ('CLIENT_SELF',  'Client Self-Service',  'SIHL', '0800', TRUE),
  ('PRODUCT_OPS',  'Product / Ops',        'SIHL', '0200', TRUE),
  ('SUPPORT_DESK', 'Support Desk',         'SIHL', '0200', TRUE),
  ('SUPPORT_LEAD', 'Support Lead',         'SIHL', '0200', TRUE)
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO user_details (uid, username, full_name, email, is_active) VALUES
  (1, 'Manesh001', 'Support Desk User', 'sneha.nair@sihl.example', TRUE),
  (2, 'Admin001',  'Platform Admin',    'rohan.mehta@sihl.example', TRUE),
  (8, 'Client001', 'Demo Client One',   'client.demo@external.example', TRUE)
ON CONFLICT (uid) DO NOTHING;

INSERT INTO user_role_map (user_uid, role_code, is_active) VALUES
  (1, 'SUPPORT_DESK', TRUE),
  (2, 'ADMIN',        TRUE),
  (8, 'CLIENT_SELF',  TRUE);
