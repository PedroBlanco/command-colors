-- Propuesta de esquema; NO ejecutada ni aprobada para producción.
-- Requiere PostgreSQL y migración revisada antes de usar.
CREATE TABLE ccw_matches (
  match_id uuid PRIMARY KEY,
  ruleset_id text NOT NULL,
  ruleset_version text NOT NULL,
  scenario_id text NOT NULL,
  scenario_version text NOT NULL,
  status text NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state_private jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ccw_match_players (
  match_id uuid NOT NULL REFERENCES ccw_matches(match_id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('A','B')),
  PRIMARY KEY (match_id,player_id),
  UNIQUE (match_id,side)
);

CREATE TABLE ccw_match_events (
  match_id uuid NOT NULL REFERENCES ccw_matches(match_id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public','player_a','player_b','server')),
  payload_private jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id,sequence)
);

CREATE TABLE ccw_match_commands (
  match_id uuid NOT NULL REFERENCES ccw_matches(match_id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_signature text NOT NULL,
  committed_revision bigint NOT NULL,
  PRIMARY KEY(match_id,player_id,idempotency_key),
  FOREIGN KEY (match_id,player_id) REFERENCES ccw_match_players(match_id,player_id)
);

-- En producción ejecutar todo el comando en UNA transacción:
-- BEGIN; SELECT ... FROM ccw_matches WHERE match_id = $1 FOR UPDATE;
-- validar sesión, pertenencia, idempotencia, expectedRevision y motor;
-- UPDATE ccw_matches SET state_private = ..., revision = revision+1;
-- INSERT INTO ccw_match_events ...; INSERT INTO ccw_match_commands ...;
-- COMMIT; notificar revisión sin información privada DESPUÉS del commit.
-- Las vistas para clientes siempre se generan con autorización y filtrado; nunca SELECT *.
