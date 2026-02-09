#!/bin/bash
# Plan for Change Dashboard — One-click starter
# Just double-click this file or run: ./start.sh

cd "$(dirname "$0")"

echo "=================================="
echo "  Plan for Change Dashboard"
echo "=================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please install it from: https://nodejs.org"
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies (first time only)..."
    npm install
    echo ""
fi

# Create database and fetch data if DB doesn't exist
if [ ! -f "data/cache/dashboard.db" ]; then
    echo "Fetching data for the first time (this takes a few minutes)..."
    mkdir -p data/cache
    npx tsx src/scripts/refresh-all.ts
    echo ""
fi

echo "Starting the dashboard..."
echo ""
echo "Opening http://localhost:3000 in your browser..."
echo "(Press Ctrl+C to stop)"
echo ""

# Open browser after a short delay
(sleep 3 && open http://localhost:3000) &

# Start the server
npm run dev
