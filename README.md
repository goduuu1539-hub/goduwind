# Livestream API - Node.js Backend

A minimal Node.js backend implementing livestream API with Express and WebSocket (ws) for real-time collaboration.

## Features

### HTTP APIs
- **Authentication**: signup/signin with token-based auth
- **Session Management**: CRUD operations, start/end sessions
- **Slide Management**: upload PDF/images, create empty slides, delete slides
- **State API**: retrieve full session state

### WebSocket Events
- **subscribe**: join a session as viewer
- **admin_subscribe**: join as admin/presenter
- **stroke**: draw strokes on slides
- **clear**: clear all strokes (admin only)
- **chat_message**: send chat messages
- **chat_enable**: enable/disable chat (admin only)

### Storage
- File uploads stored locally in `/uploads` directory
- In-memory data structures (no database required)

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file (or copy from `.env.example`):

```bash
cp .env.example .env
```

The default configuration is:

```
PORT=3000
```

### 3. Run the Server

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## API Documentation

### Authentication

#### Signup
```
POST /signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "role": "user"  // optional
}

Response: { "token": "...", "user": {...} }
```

#### Signin
```
POST /signin
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response: { "token": "...", "user": {...} }
```

**Note**: All endpoints below require authentication via `Authorization: Bearer <token>` header.

### Sessions

#### Create Session
```
POST /sessions
Content-Type: application/json

{
  "title": "My Session",
  "description": "Optional description"
}

Response: { "id": "...", "title": "...", ... }
```

#### List Sessions
```
GET /sessions

Response: [{ "id": "...", "title": "...", ... }]
```

#### Get Session
```
GET /sessions/:sessionId

Response: { "id": "...", "title": "...", ... }
```

#### Update Session
```
PUT /sessions/:sessionId
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description",
  "chatEnabled": true
}

Response: { "id": "...", "title": "...", ... }
```

#### Delete Session
```
DELETE /sessions/:sessionId

Response: 204 No Content
```

#### Start Session
```
POST /sessions/:sessionId/start

Response: { "id": "...", "status": "live", ... }
```

#### End Session
```
POST /sessions/:sessionId/end

Response: { "id": "...", "status": "ended", ... }
```

### Slides

#### Upload PDF Slide
```
POST /sessions/:sessionId/slides/pdf
Content-Type: multipart/form-data

file: <PDF file>

Response: { "id": "...", "type": "pdf", "url": "/uploads/...", ... }
```

#### Upload Image Slide
```
POST /sessions/:sessionId/slides/image
Content-Type: multipart/form-data

file: <Image file>

Response: { "id": "...", "type": "image", "url": "/uploads/...", ... }
```

#### Create Empty Slide
```
POST /sessions/:sessionId/slides/empty
Content-Type: application/json

{
  "title": "Optional title"
}

Response: { "id": "...", "type": "empty", ... }
```

#### Delete Slide
```
DELETE /sessions/:sessionId/slides/:slideId

Response: 204 No Content
```

### State

#### Get Session State
```
GET /sessions/:sessionId/state

Response: {
  "sessionId": "...",
  "state": {
    "id": "...",
    "title": "...",
    "status": "...",
    "slides": [...],
    "strokes": [...],
    "chatMessages": [...],
    ...
  }
}
```

## WebSocket Protocol

Connect to `ws://localhost:3000` and send/receive JSON messages.

### Client → Server Events

#### Subscribe (Viewer)
```json
{
  "type": "subscribe",
  "sessionId": "session-id"
}
```

#### Admin Subscribe (Presenter)
```json
{
  "type": "admin_subscribe",
  "sessionId": "session-id",
  "token": "your-auth-token"
}
```

#### Send Stroke
```json
{
  "type": "stroke",
  "stroke": {
    "slideId": "slide-id",
    "points": [[x1, y1], [x2, y2], ...],
    "color": "#000000",
    "width": 2
  }
}
```

#### Clear Strokes (Admin only)
```json
{
  "type": "clear"
}
```

#### Send Chat Message
```json
{
  "type": "chat_message",
  "text": "Hello everyone!",
  "username": "John"
}
```

#### Enable/Disable Chat (Admin only)
```json
{
  "type": "chat_enable",
  "enabled": true
}
```

### Server → Client Events

#### Subscribed Confirmation
```json
{
  "type": "subscribed",
  "sessionId": "...",
  "isAdmin": true
}
```

#### Session State
```json
{
  "type": "session_state",
  "sessionId": "...",
  "state": { ... }
}
```

#### Stroke Broadcast
```json
{
  "type": "stroke",
  "sessionId": "...",
  "stroke": { ... }
}
```

#### Clear Broadcast
```json
{
  "type": "clear",
  "sessionId": "..."
}
```

#### Chat Message Broadcast
```json
{
  "type": "chat_message",
  "sessionId": "...",
  "message": {
    "id": "...",
    "username": "...",
    "text": "...",
    "timestamp": "..."
  }
}
```

#### Chat Enable Broadcast
```json
{
  "type": "chat_enable",
  "sessionId": "...",
  "enabled": true
}
```

#### Error
```json
{
  "type": "error",
  "message": "Error description"
}
```

## Project Structure

```
.
├── server.js           # Main server file with all APIs and WebSocket logic
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variables template
├── .env                # Local environment config (create this)
├── .gitignore          # Git ignore rules
├── README.md           # This file
└── uploads/            # File upload directory (auto-created)
```

## Notes

- All data is stored in-memory and will be lost on server restart
- File uploads are stored locally in the `/uploads` directory
- Authentication uses simple token-based auth (tokens stored in-memory)
- Passwords are hashed using SHA-256
- WebSocket connections are maintained per session
- Stroke history is limited to 5000 entries per session
- Chat history is limited to 500 messages per session

## Development

The server automatically creates the `/uploads` directory on startup if it doesn't exist.

For development, you can use tools like:
- **Postman** or **curl** for testing HTTP APIs
- **wscat** or browser WebSocket clients for testing WebSocket events

Example with curl:
```bash
# Signup
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Create session (use token from signup)
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"title":"Test Session"}'
```

## License

MIT
