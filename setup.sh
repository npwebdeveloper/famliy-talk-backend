#!/bin/bash

echo "🚀 Setting up Family Talk Backend..."
echo ""

# Check if MySQL is running
echo "📊 Checking MySQL connection..."
if ! mysql -u root -e "SELECT 1" &> /dev/null; then
    echo "❌ MySQL is not running or credentials are incorrect"
    echo "Please start MySQL and update DB_PASSWORD in .env file"
    exit 1
fi

echo "✅ MySQL is running"
echo ""

# Create database
echo "📦 Creating database..."
mysql -u root -e "CREATE DATABASE IF NOT EXISTS family_talk;" 2>/dev/null
echo "✅ Database 'family_talk' created/verified"
echo ""

# Create uploads directories
echo "📁 Creating upload directories..."
mkdir -p uploads/avatars
mkdir -p uploads/media
echo "✅ Upload directories created"
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update DB_PASSWORD in .env file with your MySQL password"
echo "2. Run: npm run start:dev"
echo "3. Server will start on http://localhost:3000"
echo ""
