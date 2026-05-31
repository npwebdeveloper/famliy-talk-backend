# Family Talk Backend

A production-ready NestJS backend for the Family Talk messaging application with MySQL database, JWT authentication, and real-time WebSocket communication.

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
