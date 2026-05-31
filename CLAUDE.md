# Family Talk Backend

## Project Overview
NestJS REST API + WebSocket gateway for the Family Talk chat app. Phone OTP auth, JWT tokens, MySQL via TypeORM, real-time messaging with Socket.IO.

## Tech Stack
- **Framework**: NestJS 11 (TypeScript)
- **Database**: MySQL via TypeORM (`synchronize: true` — auto-migrates in dev)
- **Auth**: JWT (access + refresh tokens) + Passport
- **Real-time**: Socket.IO via `@nestjs/websockets`
- **File uploads**: Multer (avatars stored in `./uploads/avatars/`)
- **Validation**: class-validator + class-transformer (global ValidationPipe)

## Port
Backend runs on **port 4000** (set `PORT=4000` in `.env`).  
Frontend connects to this port via `api.config.ts`.

## Module Structure
```
src/
  app.module.ts           # Root: ConfigModule, TypeORM, ServeStatic, all feature modules
  auth/                   # OTP send/verify, JWT issue, refresh, logout
  users/                  # Profile CRUD, avatar upload, search, online status
  conversations/          # Create/list/get conversations, mark read
  messages/               # Send/list/delete messages, mark read
  websocket/              # ChatGateway — Socket.IO real-time events
  common/decorators/      # @CurrentUser() decorator
```

## API Endpoints

### Auth (`/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/send-otp` | No | Send OTP to phone (static: `123456` in dev) |
| POST | `/auth/verify-otp` | No | Verify OTP, returns accessToken + refreshToken + user |
| POST | `/auth/refresh-token` | No | Refresh access token |
| POST | `/auth/logout` | JWT | Set isOnline=false |
| GET | `/auth/me` | JWT | Get current user from token |

### Users (`/users`) — all JWT protected
| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Get own profile |
| PUT | `/users/profile` | Update name/bio |
| POST | `/users/avatar` | Upload avatar image (5MB max, jpg/jpeg/png/gif) |
| GET | `/users/search?query=` | Search users (min 2 chars) |
| PUT | `/users/status` | Update isOnline status |

### Conversations (`/conversations`) — all JWT protected
| Method | Path | Description |
|--------|------|-------------|
| POST | `/conversations` | Create conversation |
| GET | `/conversations?page=1&limit=20` | List user's conversations |
| GET | `/conversations/:id` | Get single conversation |
| PUT | `/conversations/:id/read` | Mark conversation as read |

### Messages (`/messages`) — all JWT protected
| Method | Path | Description |
|--------|------|-------------|
| POST | `/messages` | Send message |
| GET | `/messages/conversation/:id?page=1&limit=50` | Get messages in conversation |
| POST | `/messages/:id/read` | Mark message as read |
| DELETE | `/messages/:id` | Delete message |

## WebSocket (ChatGateway)
- Token passed via `socket.handshake.auth.token`
- Tracks `userId → socketId` in-memory map
- On connect: updates `isOnline=true`, emits `user_online` to all
- On disconnect: updates `isOnline=false`, `lastSeen`, emits `user_offline`
- CORS: `origin: '*'` (restrict in production)

## Database Entities
- **User**: id (UUID), phoneNumber, name, bio, avatarUrl, isOnline, lastSeen
- **OtpVerification**: phoneNumber, otpCode, expiresAt (5min), isVerified
- **Conversation**: participants (many-to-many with User), messages
- **Message**: content, senderId, conversationId, isRead, type

## Environment Variables (`.env`)
```
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=family_talk
JWT_SECRET=your-secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d
STATIC_OTP=123456
PORT=4000
```

## OTP Behavior (Dev)
- Static OTP from `STATIC_OTP` env var (default: `123456`)
- Rate limited: max 3 OTPs per phone per hour
- Expires in 5 minutes
- Production: wire in Twilio/AWS SNS in `auth.service.ts → sendOtp()`

## Static Files
Uploaded avatars served at `/uploads/avatars/<filename>` via ServeStatic from `./uploads/`.

## Run Commands
```bash
npm run start:dev    # Watch mode (development)
npm run build        # Compile to dist/
npm run start:prod   # Run compiled dist/main
```

## What's Complete
- Phone OTP auth with JWT access + refresh tokens
- User profile management + avatar upload
- Conversations CRUD
- Messages CRUD with pagination
- Socket.IO gateway with online/offline status tracking
- Global JWT guard via Passport
- `@CurrentUser()` decorator for extracting user from JWT
- TypeORM auto-sync (dev only)

## What Needs Work / Next Steps
- Update this section as features are added
