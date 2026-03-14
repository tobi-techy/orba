#!/bin/sh
# Wait for database to be ready, then push schema and start app

MAX_RETRIES=30
RETRY_INTERVAL=2

echo "Waiting for database..."
for i in $(seq 1 $MAX_RETRIES); do
  if bunx prisma db push --skip-generate 2>/dev/null; then
    echo "Database schema pushed successfully"
    break
  fi
  echo "Attempt $i/$MAX_RETRIES failed, retrying in ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done

echo "Starting server..."
exec bun src/index.ts
