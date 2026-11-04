#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable CI PostgreSQL service}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE outbound_send_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared','submitting','accepted','rejected','outcome_unknown')),
  UNIQUE (tenant_id, idempotency_key)
);
SQL

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# Race independent PostgreSQL sessions for the same tenant/key. The unique
# constraint must permit exactly one claim, regardless of scheduling.
for i in $(seq 1 32); do
  (
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "
      INSERT INTO outbound_send_attempts
        (tenant_id, idempotency_key, request_hash, status)
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'same-request-key', 'hash-a', 'prepared')
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id;
    " > "$tmpdir/result-$i"
  ) &
done
wait

claims="$(cat "$tmpdir"/result-* | grep -c . || true)"
if [[ "$claims" -ne 1 ]]; then
  echo "Expected exactly one winning claim for 32 concurrent requests; got $claims" >&2
  exit 1
fi

# The key is scoped by tenant: another tenant can legitimately use it.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "
  INSERT INTO outbound_send_attempts
    (tenant_id, idempotency_key, request_hash, status)
  VALUES
    ('00000000-0000-0000-0000-000000000002', 'same-request-key', 'hash-b', 'prepared')
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING id;
" > "$tmpdir/tenant-b"

if [[ "$(grep -c . "$tmpdir/tenant-b" || true)" -ne 1 ]]; then
  echo "Expected a separate tenant to claim the same idempotency key" >&2
  exit 1
fi

echo "PostgreSQL concurrency passed: 1/32 same-tenant claims; separate-tenant key accepted."
