#!/bin/bash
set -e

cd /root/study-timeline-deploy

echo "=== Building frontend ==="
cd frontend
npm install --silent
npm run build
cd ..

echo "=== Rebuilding backend (no cache) ==="
docker compose down
docker compose build --no-cache

echo "=== Starting services ==="
docker compose up -d

echo "=== Done ==="
docker compose ps
