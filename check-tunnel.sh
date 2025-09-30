#!/bin/bash

# Script to check current Cloudflare Tunnel URL

echo "🔍 Checking Cloudflare Tunnel Status..."
echo ""

# Check if cloudflared is running
if pgrep -f "cloudflared tunnel" > /dev/null; then
    echo "✅ Cloudflare Tunnel is running"
    echo ""
    
    # Get the tunnel URL from logs
    TUNNEL_URL=$(cat /tmp/cloudflared.log 2>/dev/null | grep "https://" | tail -1 | grep -o 'https://[^[:space:]]*' | head -1)
    
    if [ ! -z "$TUNNEL_URL" ]; then
        echo "🌐 Your Tunnel URL:"
        echo "   $TUNNEL_URL"
        echo ""
        echo "📡 Webhook URL for Paystack:"
        echo "   $TUNNEL_URL/webhooks/paystack"
        echo ""
        echo "🔧 Update your .env file with:"
        echo "   PAYSTACK_WEBHOOK_URL=$TUNNEL_URL/webhooks/paystack"
    else
        echo "⚠️  Tunnel URL not found in logs"
        echo "   Try restarting the tunnel: ./start-tunnel.sh"
    fi
else
    echo "❌ Cloudflare Tunnel is not running"
    echo ""
    echo "🚀 Start it with: ./start-tunnel.sh"
fi

echo ""
echo "📊 Tunnel Process Info:"
ps aux | grep cloudflared | grep -v grep | head -1
