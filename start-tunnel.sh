#!/bin/bash

# Cloudflare Tunnel Management Script
# This script starts a stable tunnel for webhook testing

echo "🚀 Starting Cloudflare Tunnel for Payment Service..."
echo ""

# Kill any existing cloudflared processes
pkill cloudflared 2>/dev/null

# Clear previous logs
> /tmp/cloudflared.log

# Start the tunnel in background and capture output
echo "Starting tunnel to http://localhost:8888..."
cloudflared tunnel --url http://localhost:8888 > /tmp/cloudflared.log 2>&1 &

# Wait for tunnel to start and get URL
echo "⏳ Waiting for tunnel to initialize..."
sleep 5

# Extract tunnel URL from logs
TUNNEL_URL=$(cat /tmp/cloudflared.log | grep "https://" | tail -1 | grep -o 'https://[^[:space:]]*' | head -1)

if [ ! -z "$TUNNEL_URL" ]; then
    echo ""
    echo "✅ Tunnel started successfully!"
    echo ""
    echo "🌐 Your Tunnel URL:"
    echo "   $TUNNEL_URL"
    echo ""
    echo "📡 Webhook URL for Paystack:"
    echo "   $TUNNEL_URL/webhooks/paystack"
    echo ""
    echo "🔧 Update your .env file with:"
    echo "   PAYSTACK_WEBHOOK_URL=$TUNNEL_URL/webhooks/paystack"
    echo ""
    echo "📝 Tunnel URL logged to: /tmp/cloudflared.log"
    echo "🔄 Check tunnel status anytime with: ./check-tunnel.sh"
else
    echo ""
    echo "❌ Failed to get tunnel URL"
    echo "📋 Check logs: cat /tmp/cloudflared.log"
    echo "🔄 Try again: ./start-tunnel.sh"
fi
