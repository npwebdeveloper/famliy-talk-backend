# Family Talk Backend

A production-ready NestJS backend for the Family Talk messaging application with MySQL database, JWT authentication, and real-time WebSocket communication.

## Features

- 📱 **Phone-based Authentication** with OTP verification (static OTP for development)
- 🔐 **JWT Token Authentication** with access and refresh tokens
- 👤 **User Management** with profile, avatar upload, and search
- 💬 **Real-time Messaging** via Socket.IO WebSocket
- 📊 **Conversation Management** (private and group chats)
- ✅ **Message Status Tracking** (sent, delivered, read)
- 📁 **File Upload** support (local storage)
- 🔍 **User Search** functionality
- 🟢 **Online/Offline Status** tracking

## Tech Stack

- **Framework**: NestJS (TypeScript)
- **Database**: MySQL 8.0+
- **ORM**: TypeORM
- **Authentication**: JWT + Passport
- **Real-time**: Socket.IO
- **Validation**: class-validator, class-transformer
- **File Upload**: Multer

## Prerequisites

- Node.js >= 16.x
- MySQL >= 8.0
- npm or yarn

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create a MySQL database:

```sql
CREATE DATABASE family_talk;
```

### 3. Environment Configuration

The `.env` file is already created with default values. Update if needed:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_mysql_password
DB_DATABASE=family_talk

# JWT
JWT_SECRET=dev-secret-key-12345
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=dev-refresh-secret-67890
JWT_REFRESH_EXPIRES_IN=7d

# Static OTP for development
STATIC_OTP=123456

# File Upload
UPLOAD_DESTINATION=./uploads
MAX_FILE_SIZE=52428800

# Server
PORT=3000
```

**Important**: Update `DB_PASSWORD` with your MySQL root password.

### 4. Run Database Migrations

The application uses `synchronize: true` in development, which automatically creates tables. On first run, TypeORM will create all tables automatically.

## Running the Application

### Development Mode

```bash
npm run start:dev
```

The server will start on `http://localhost:3000`

### Production Mode

```bash
npm run build
npm run start:prod
```

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/send-otp` | Send OTP to phone number | No |
| POST | `/auth/verify-otp` | Verify OTP and get tokens | No |
| POST | `/auth/refresh-token` | Refresh access token | No |
| POST | `/auth/logout` | Logout user | Yes |
| GET | `/auth/me` | Get current user info | Yes |

### Users

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/users/me` | Get current user profile | Yes |
| PUT | `/users/profile` | Update profile (name, bio) | Yes |
| POST | `/users/avatar` | Upload avatar image | Yes |
| GET | `/users/search?query=name` | Search users | Yes |
| PUT | `/users/status` | Update online status | Yes |

### Conversations

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/conversations` | Create new conversation | Yes |
| GET | `/conversations` | Get all conversations | Yes |
| GET | `/conversations/:id` | Get conversation by ID | Yes |
| PUT | `/conversations/:id/read` | Mark conversation as read | Yes |

### Messages

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/messages` | Send a message | Yes |
| GET | `/messages/conversation/:id` | Get messages by conversation | Yes |
| POST | `/messages/:id/read` | Mark message as read | Yes |
| DELETE | `/messages/:id` | Delete a message | Yes |

## WebSocket Events

### Client → Server

- `join_conversation` - Join a conversation room
- `leave_conversation` - Leave a conversation room
- `send_message` - Send a message
- `typing_start` - User started typing
- `typing_stop` - User stopped typing
- `mark_read` - Mark message as read

### Server → Client

- `new_message` - New message received
- `message_read` - Message was read
- `user_typing` - User is typing
- `user_stopped_typing` - User stopped typing
- `user_online` - User came online
- `user_offline` - User went offline

## WebSocket Connection

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token'
  }
});

// Join a conversation
socket.emit('join_conversation', { conversationId: 'conv-id' });

// Send a message
socket.emit('send_message', {
  conversationId: 'conv-id',
  text: 'Hello!',
  type: 'text'
});

// Listen for new messages
socket.on('new_message', (message) => {
  console.log('New message:', message);
});
```

## Example API Usage

### 1. Send OTP

```bash
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890"}'
```

### 2. Verify OTP (Use static OTP: 123456)

```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+1234567890",
    "otp": "123456"
  }'
```

Response:
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "phoneNumber": "+1234567890",
    "name": "",
    "isOnline": true
  }
}
```

### 3. Update Profile

```bash
curl -X PUT http://localhost:3000/users/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "name": "John Doe",
    "bio": "Hello, I am using Family Talk!"
  }'
```

### 4. Create Conversation

```bash
curl -X POST http://localhost:3000/conversations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "participantIds": ["other-user-id"]
  }'
```

### 5. Send Message

```bash
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "conversationId": "conversation-id",
    "text": "Hello!",
    "type": "text"
  }'
```

## Database Schema

### Tables

1. **users** - User profiles and authentication
2. **conversations** - Chat conversations (private/group)
3. **conversation_participants** - User-conversation relationships
4. **messages** - Chat messages
5. **message_status** - Message delivery/read status
6. **otp_verifications** - OTP verification records

## Project Structure

```
src/
├── auth/                   # Authentication module
│   ├── dto/               # Data transfer objects
│   ├── entities/          # OTP verification entity
│   ├── guards/            # JWT auth guard
│   ├── strategies/        # JWT strategy
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── auth.module.ts
├── users/                  # User management module
│   ├── dto/
│   ├── entities/
│   ├── users.controller.ts
│   ├── users.service.ts
│   └── users.module.ts
├── conversations/          # Conversation management
│   ├── dto/
│   ├── entities/
│   ├── conversations.controller.ts
│   ├── conversations.service.ts
│   └── conversations.module.ts
├── messages/              # Message handling
│   ├── dto/
│   ├── entities/
│   ├── messages.controller.ts
│   ├── messages.service.ts
│   └── messages.module.ts
├── websocket/             # Real-time WebSocket
│   ├── chat.gateway.ts
│   └── websocket.module.ts
├── common/                # Shared utilities
│   └── decorators/
├── app.module.ts          # Main app module
└── main.ts                # Application entry point
```

## Development Notes

### Static OTP

For development, the OTP is hardcoded to `123456`. This is configured in the `.env` file:

```env
STATIC_OTP=123456
```

In production, replace this with actual SMS service integration (Twilio, AWS SNS, etc.).

### File Uploads

Files are stored locally in the `./uploads` directory:
- Avatars: `./uploads/avatars/`
- Media: `./uploads/media/`

For production, consider using cloud storage (AWS S3, Cloudinary, etc.).

### Database Synchronization

The app uses `synchronize: true` in development, which automatically updates the database schema. **Disable this in production** and use proper migrations:

```typescript
// In app.module.ts
synchronize: false, // Set to false in production
```

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Troubleshooting

### MySQL Connection Error

If you get a connection error, check:
1. MySQL is running: `mysql.server start` (macOS) or `sudo service mysql start` (Linux)
2. Database exists: `CREATE DATABASE family_talk;`
3. Credentials in `.env` are correct
4. MySQL port is 3306 (default)

### Port Already in Use

If port 3000 is in use, change it in `.env`:

```env
PORT=3001
```

## Next Steps

1. ✅ Backend is ready to use
2. 🔄 Integrate with React Native frontend
3. 📱 Test real-time messaging
4. 🚀 Deploy to production server

## License

MIT
