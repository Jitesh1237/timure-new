#!/bin/bash
# Timure Yatayat - Change Admin Password
# Usage: ./change-password.sh [server-url]
# Default server URL: http://localhost:5000

SERVER_URL="${1:-http://localhost:5000}"

echo "================================"
echo "  Timure Yatayat - Change Password"
echo "================================"
echo ""

# Get current password
read -s -p "Enter CURRENT password: " OLD_PASS
echo ""

# Get new password
read -s -p "Enter NEW password: " NEW_PASS
echo ""
read -s -p "Confirm NEW password: " NEW_PASS2
echo ""

if [ "$NEW_PASS" != "$NEW_PASS2" ]; then
    echo "❌ Passwords don't match!"
    exit 1
fi

if [ -z "$NEW_PASS" ]; then
    echo "❌ Password cannot be empty!"
    exit 1
fi

echo ""
echo "Logging in..."

# Step 1: Login to get token
LOGIN_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"admin\", \"password\": \"$OLD_PASS\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed! Check your current password."
    echo "   Response: $LOGIN_RESPONSE"
    exit 1
fi

echo "✅ Logged in successfully!"

# Step 2: Change password
echo "Changing password..."
CHANGE_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/auth/change-password" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"currentPassword\": \"$OLD_PASS\", \"newPassword\": \"$NEW_PASS\"}")

if echo "$CHANGE_RESPONSE" | grep -q "successfully"; then
    echo "✅ Password changed successfully!"
else
    echo "❌ Failed to change password!"
    echo "   Response: $CHANGE_RESPONSE"
    exit 1
fi

echo ""
echo "================================"
echo "  Done! Use your new password to login."
echo "================================"
