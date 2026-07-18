# Family Talk Backend

## Project Overview
NestJS REST API + WebSocket gateway for the Family Talk chat app. Phone OTP auth, JWT tokens, MySQL via TypeORM, real-time messaging with Socket.IO.

## Tech Stack
- **Framework**: NestJS 11 (TypeScript)
- **Database**: MySQL via TypeORM (`synchronize: false` — schema managed by migrations, see Migrations section)
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
- On connect: updates `isOnline=true`, emits `user_online` to all, **and runs a delivery sweep** — all pending `SENT` statuses for that user flip to `DELIVERED`, senders notified live
- On disconnect: updates `isOnline=false`, `lastSeen`, emits `user_offline`
- CORS: `origin: '*'` (restrict in production)

## Message Status (ticks) — see MESSAGE_STATUS_FRONTEND.md for full contract
- `message_status` row per recipient: `sent → delivered → read` (never downgrades; read backfills `deliveredAt`)
- Separate `delivered_at` / `read_at` timestamp columns
- Status change methods return `{ senderId, conversationId }` so gateway can notify
- `notifyStatusChange()`: emits to conversation room + directly to sender's socket (deduped — skipped if sender already in room), so ticks update even on the chat-list screen
- REST parity: `POST /messages` also emits `new_message` to the room; `POST /messages/:id/read` also emits `message_read` (gateway injected into MessagesController via `forwardRef`)
- Client-emitted events: `message_delivered` (msg received, chat closed), `mark_conversation_read` (chat opened — bulk read), `mark_read` (single)

## Database Entities
- **users**: id (UUID), phone_number, name, bio, avatar_url, is_online, last_seen
- **otp_verifications**: phone_number, otp_code, expires_at (5min), is_verified
- **conversations**: id, type (private/group), name, avatar_url
- **conversation_participants**: conversation_id, user_id, joined_at, last_read_at
- **messages**: id, conversation_id, sender_id, text, type, media_url
- **message_status**: message_id, user_id, status (sent/delivered/read)
- **user_contacts**: id, owner_id (FK→users), phone_number, contact_name, is_registered, registered_user_id (FK→users nullable)

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
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
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
Requires **Node 20+** (`.nvmrc` pins 22 — run `nvm use`).

## Database Migrations (TypeORM)

`synchronize` is **permanently off** — it silently drops renamed/removed columns. Every schema change goes through a migration file in `src/migrations/`. CLI config: [src/data-source.ts](src/data-source.ts) (reads `.env`).

**Local workflow (after changing any entity):**
```bash
npm run migration:generate -- src/migrations/DescriptiveName  # diff entities vs DB → new file
npm run migration:run                                          # apply pending migrations
npm run migration:show                                         # [X] applied / [ ] pending
npm run migration:revert                                       # undo last migration
```

**Production (SSH into server):**
```bash
git pull && npm ci && npm run build
npm run migration:run:prod    # runs compiled dist/migrations against prod DB
# then restart the app (pm2 restart family-talk)
```

Rules:
- Always review the generated SQL before running — especially DROP statements
- Baseline = 7 per-table migrations (`CreateUsersTable` … `CreateUserContactsTable`), one file per table, FK-dependency ordered: users → otp_verifications → conversations → conversation_participants → messages → message_status → user_contacts
- If a DB already has the tables (created before migrations existed): `npm run migration:run -- --fake` once to mark as applied without executing

## Contacts Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/users/sync-contacts` | JWT | Bulk upsert contacts, returns registered users |

- `SyncContactsDto`: `{ contacts: [{ phoneNumber, contactName }] }`
- Response: `{ registeredContacts: [{ id, name, phoneNumber, avatarUrl, isOnline, lastSeen }] }`
- On new user registration (`verifyOtp`): auto-marks `user_contacts` rows with matching phone as `is_registered=true`

## Push Notifications (FCM)

Module: `src/notifications/` — `NotificationsService` wraps `firebase-admin`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/users/fcm-token` | JWT | Save device FCM token (`{ fcmToken }`) |

- Config: `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` → service account JSON from Firebase Console. **Unset = notifications gracefully disabled** (backend runs fine, logs a warning).
- `users.fcm_token` column stores one token per user (last device wins).
- Triggers:
  - **New message** (`MessagesService.create`): push to recipients who are **offline** (`is_online=false`) — online users get it via socket. Fire-and-forget, never blocks the send. **Privacy**: push contains only sender name + "New message 💬" — message content never goes through FCM/Google; app fetches it on open.
  - **Contact joined** (`AuthService.verifyOtp`, new user only): push "X joined Family Talk" to every user who had that phone number in `user_contacts`, using their saved contact name.
- Stale tokens (`registration-token-not-registered` etc.) are auto-cleared from DB.
- Logout clears `fcm_token` so logged-out devices stop receiving pushes.
- Credential JSON is gitignored (`firebase-service-account.json`).

## What's Complete
- Phone OTP auth with JWT access + refresh tokens
- User profile management + avatar upload
- Conversations CRUD (private + group, returns existing private conversation if already exists)
- Messages CRUD with pagination
- Socket.IO gateway with online/offline status tracking
- Global JWT guard via Passport
- `@CurrentUser()` decorator for extracting user from JWT
- TypeORM migrations (synchronize permanently off)
- `user_contacts` table + `POST /users/sync-contacts` endpoint
- Auto-mark contacts as registered when new user signs up
- FCM push notifications (new message to offline users + contact joined) — needs Firebase service account JSON to activate

## What Needs Work / Next Steps
- Group chat endpoints
- Message search
