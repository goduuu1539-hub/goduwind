# Livestream Backend

Node.js backend server for livestream sessions with Express and WebSocket support.

## Features

- User authentication (signup/signin) with JWT
- Session management with unique session IDs (format: `aaa-bbb-ccc`)
- Real-time WebSocket communication for drawing strokes and chat
- File upload support for PDF and image slides
- In-memory data storage
- RESTful HTTP API

## Prerequisites

- Node.js (v14 or higher)
- npm

## Installation

1. Clone the repository or extract the project files

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Edit the `.env` file and set your environment variables:
```env
PORT=3000
JWT_SECRET=your-secret-key-change-this-in-production
ASSET_BASE_URL=http://localhost:3000
```

**Important**: Change `JWT_SECRET` to a secure random string in production.

## Running the Server

Start the server:
```bash
npm start
```

The server will start on the port specified in your `.env` file (default: 3000).

You should see:
```
Server listening on port 3000
```

## API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### HTTP Endpoints

#### Authentication

**POST /api/v1/signup**
- Create a new user account
- Request body:
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "name": "User Name" // optional
  }
  ```
- Responses:
  - `201`: User created successfully
  - `400`: Invalid request
  - `409`: User already exists

**POST /api/v1/signin**
- Sign in to get JWT token
- Request body:
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```
- Responses:
  - `200`: Success with token
    ```json
    {
      "token": "jwt-token-here"
    }
    ```
  - `400`: Bad request
  - `401`: Invalid credentials

#### Sessions

All session endpoints require authentication via `Authorization: Bearer <token>` header.

**POST /api/v1/session**
- Create a new session
- Request body:
  ```json
  {
    "title": "My Session",
    "description": "Session description"
  }
  ```
- Response: `201` with session object

**GET /api/v1/sessions**
- List all sessions
- Response: `200` with array of sessions

**POST /api/v1/session/:sessionId/start**
- Start a session (owner only)
- Response: `200` on success, `404` if not found, `400` if unauthorized

**POST /api/v1/session/:sessionId/end**
- End a session (owner only)
- Response: `200` on success, `404` if not found, `400` if unauthorized

**GET /api/v1/session/:sessionId/state**
- Get session state including slides and strokes
- Response: `200` with full session state

#### Slides

**POST /api/v1/session/:sessionId/slides/pdf**
- Upload a PDF file as a slide
- Content-Type: `multipart/form-data`
- Form field: `file` (PDF file)
- Response: `200` with updated slides array

**POST /api/v1/session/:sessionId/slides/image**
- Upload an image file as a slide
- Content-Type: `multipart/form-data`
- Form field: `file` (image file)
- Response: `200` with updated slides array

**POST /api/v1/session/:sessionId/slides**
- Add an empty slide
- Response: `200` with updated slides array

**DELETE /api/v1/session/:sessionId/slide/:slideId**
- Delete a slide
- Response: `200` on success, `404` if not found

### WebSocket Connection

Connect to WebSocket server at:
```
ws://localhost:3000?token=<jwt-token>
```

#### Message Format

All WebSocket messages use JSON format:
```json
{
  "type": "MESSAGE_TYPE",
  "payload": { /* message-specific data */ }
}
```

#### Client → Server Events

**SUBSCRIBE**
- Subscribe to a session as a participant
- Payload:
  ```json
  {
    "roomId": "abc-def-ghi"
  }
  ```

**SUBSCRIBE_ADMIN**
- Subscribe to a session as admin (owner only)
- Payload:
  ```json
  {
    "roomId": "abc-def-ghi"
  }
  ```

**STROKE** (admin only)
- Add a drawing stroke to a slide
- Payload:
  ```json
  {
    "slideId": "slide-id",
    "stroke": {
      "points": [[x1, y1], [x2, y2], ...],
      "color": "#000000",
      "width": 2
    }
  }
  ```

**CLEAR_SLIDE** (admin only)
- Clear all strokes from a slide
- Payload:
  ```json
  {
    "slideId": "slide-id"
  }
  ```

**CHAT_MESSAGE**
- Send a chat message
- Payload:
  ```json
  {
    "message": "Hello everyone!"
  }
  ```

**CHAT_ENABLE** (admin only)
- Enable or disable chat
- Payload:
  ```json
  {
    "enabled": true
  }
  ```

#### Server → Client Events

**SUBSCRIBED**
- Sent after successful subscription
- Payload: Current session state

**SLIDE_CHANGED**
- Sent when the current slide changes
- Payload: New slide information

**STROKE**
- Sent when a new stroke is added
- Payload: Stroke data

**CLEAR_SLIDE**
- Sent when a slide is cleared
- Payload: Slide ID

**CHAT_MESSAGE**
- Sent when a chat message is received
- Payload: Message data

**CHAT_ENABLE**
- Sent when chat is enabled/disabled
- Payload: Chat status

**SESSION_STARTED**
- Sent when a session starts
- Payload: Session ID

**SESSION_ENDED**
- Sent when a session ends
- Payload: Session ID

**ERROR**
- Sent when an error occurs
- Payload: Error message

## Session ID Format

Session IDs follow the format: `xxx-xxx-xxx` where each `x` is a lowercase letter (a-z).

Example: `abc-def-ghi`

## File Uploads

- Uploaded files are stored in the `/uploads` directory
- Files are served statically at `/uploads/<filename>`
- PDF files return a placeholder image (real conversion is optional)
- Supported image formats: All formats with `image/*` MIME type

## Data Storage

This implementation uses in-memory storage. All data will be lost when the server restarts.

For production use, consider integrating a database like PostgreSQL or MongoDB.

## Security Notes

- Always use a strong, random `JWT_SECRET` in production
- Enable HTTPS in production
- Consider adding rate limiting for API endpoints
- Validate and sanitize all user inputs
- Implement proper error handling and logging

## License

MIT
