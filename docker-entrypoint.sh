#!/bin/sh

# 1. Start aktools in the background
echo "Starting aktools server on port 8080..."
python3 -m aktools --host 0.0.0.0 --port 8080 &

# 2. Run the main Node/Bun application (replacing the shell process)
echo "Starting aurum-watch server..."
exec node dist-server/index.js
