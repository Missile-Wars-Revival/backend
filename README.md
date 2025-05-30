# Missile Wars Backend

The official backend server for Missile Wars, developed by [longtimeno-c](https://github.com/longtimeno-c).

## ⚠️ License & Usage Notice
This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). This means:

- ✅ You can view and fork this code
- ✅ You can use this code for personal projects
- ✅ You can modify the code
- ❌ You cannot use this code in closed-source commercial projects
- ❗ Any modifications or usage of this code must be made open source
- ❗ You must include the original license and copyright notice

For the full license text, see [LICENSE](LICENSE.md)

Copyright (c) 2024 longtimeno-c. All rights reserved.

## 🚀 Features
- Real-time game state management using WebSockets (Middle Earth Library)
- Secure authentication system
- Push notifications via Firebase and expo notifications
- Email notification system
- Database integration with Prisma

## 📋 Prerequisites
- Node.js (v16.x or higher)
- npm (v8.x or higher)
- PostgreSQL database
- Firebase account for notifications and real time messaging 
- SMTP server access for emails

## 🛠️ Setup

### 1. Environment Configuration
Create an `.env` file in the root directory:
```env
# Server Configuration
NODE_ENV="development"
JWT_SECRET="your-secure-secret-here"  # Generate a secure random string
VERBOSE_MODE="ON"
DISABLE_AUTH="OFF"
PORT=3000

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER="your-email@domain.com"
EMAIL_PASS="your-app-specific-password"
EMAIL_FROM="noreply@yourdomain.com"

# WebSocket Configuration (Middle Earth)
WS_PORT=3001
WS_HEARTBEAT_INTERVAL=30000
```

### 2. Firebase Setup
1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Download your Firebase service account credentials
3. Rename the credentials file to `firebasecred.json` and place it in the project root
4. This enables real-time push notifications for android devices, profile picture storage and secure firebase authenticaiton / account management.

## 🚀 Running the Server

### Install Dependencies
```bash
npm install
```

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## 🗄️ Database Management (Prisma)

### Schema Management
```bash
# Pull current database schema
npx prisma db pull 

# Generate Prisma Client
npx prisma generate

# Open Prisma Studio (GUI database editor)
npx prisma studio
```

### Schema Migrations
```bash
# Create a new migration
npx prisma migrate dev --create-only

# Apply migration
npx prisma migrate dev
```

## 📦 Data Migration Tools

### Export Database
```bash
npx ts-node export-script.ts
```

### Import Database
1. Update your `.env` file with new database credentials
2. Update schema if necessary
3. Run import script:
```bash
npx ts-node import-script.ts
```

## 🤝 Contributing
Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📝 Support
For support, please open an issue in the GitHub repository or contact me on [X](https://x.com/ReTristanHill).

## ✨ Acknowledgments
- Middle Earth Library
- Firebase
- Prisma Team
- Expo Team