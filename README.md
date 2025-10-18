# Livestream API Backend

Production-ready RESTful backend for a collaborative livestreaming experience. The service exposes JSON APIs for authentication, session management, and slides as well as a WebSocket gateway for real-time collaboration. It is built with TypeScript, Express, Prisma, PostgreSQL, and `ws`.

## Features

- **Authentication** – Signup/signin with hashed passwords and JWT authentication.
- **Session lifecycle** – Create sessions with human-friendly IDs, start/end control, and persistent state.
- **Slide management** – Upload PDFs (with placeholder previews), upload images, create empty slides, and delete slides.
- **Realtime collaboration** – WebSocket server for strokes, chat, slide updates, and admin controls.
- **File uploads** – Multer-powered uploads saved to `/uploads` and served via HTTP.
- **Database persistence** – Prisma ORM backed by PostgreSQL for users, sessions, slides, and strokes.
- **Docker-ready** – Containerized services with `docker-compose` bringing up PostgreSQL and the API.

## Technology Stack

- Node.js 20
- TypeScript + Express 4
- Prisma ORM + PostgreSQL
- WebSockets via `ws`
- Validation via Zod
- Authentication via `jsonwebtoken` and `bcryptjs`
- File uploads with Multer

## Prerequisites

- Node.js >= 20
- npm >= 9
- PostgreSQL 14+ (for local development)

## Environment configuration

Create a `.env` file based on the template:

```bash
cp .env.example .env
```

`/.env.example` lists the required variables:

```
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/livestream
JWT_SECRET=change-me
ASSET_BASE_URL=http://localhost:3000
UPLOAD_DIR=uploads
```

Adjust `DATABASE_URL`, `JWT_SECRET`, and `ASSET_BASE_URL` as needed for your environment.

## Local development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Generate Prisma client**
   ```bash
   npx prisma generate
   ```

3. **Apply database migrations**
   ```bash
   npm run prisma:migrate:dev
   # or for an existing database
   npm run prisma:migrate
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

   The REST API is served on `http://localhost:3000` (configurable via `PORT`).

## Database utilities

- `npm run prisma:generate` – regenerate Prisma client
- `npm run prisma:migrate:dev` – create/apply migrations in development (interactive)
- `npm run prisma:migrate` – apply migrations in production / CI environments
- `npm run prisma:studio` – open Prisma Studio for inspecting data

## Docker usage

Build and start the stack (API + PostgreSQL):

```bash
docker-compose up --build
```

The compose file provisions:
- `db`: PostgreSQL 16 with persistent volume `postgres-data`
- `app`: Node.js API container (builds TypeScript, runs migrations on boot)
- `uploads`: named volume mounted at `/app/uploads`

Before first run you may want to tailor `.env` or environment variables in `docker-compose.yml`.

## API Endpoints

All JSON responses include an `error` field on failure. Unless otherwise stated, endpoints under `/api/v1` require the `Authorization: Bearer <token>` header.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/signup` | Create a user. Returns `{ message, userId, email }`. |
| `POST` | `/api/v1/signin` | Login and receive `{ token, userId }`. |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/session` | Create a session and receive `{ sessionId }` (format `abc-def-ghi`). |
| `GET` | `/api/v1/sessions` | List sessions owned by the authenticated user. |
| `POST` | `/api/v1/session/:sessionId/start` | Start a session (400 if already started or ended). |
| `POST` | `/api/v1/session/:sessionId/end` | End a live session (400 if not live). |

### Slides

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/session/:sessionId/slides/pdf` | Upload a PDF (`multipart/form-data`, `file`). Returns full slide list; preview URL is a placeholder image. |
| `POST` | `/api/v1/session/:sessionId/slides/image` | Upload an image (`multipart/form-data`, `file`). Returns full slide list. |
| `POST` | `/api/v1/session/:sessionId/slides` | Create an empty slide (optional JSON body `{ "title": "" }`). Returns full slide list. |
| `DELETE` | `/api/v1/session/:sessionId/slide/:slideId` | Delete a slide and associated strokes. Returns updated slide list. |

### Session state

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/session/:sessionId/state` | Retrieve `{ sessionId, currentSlideId, slides, strokes }` for the current slide. |

### Uploads

- Uploaded assets are saved under `UPLOAD_DIR` (default `uploads/`).
- They are served at `GET /uploads/:filename`.
- A placeholder SVG for PDFs is served from `GET /static/placeholders/pdf.svg`.

## WebSocket API

Connect via: `ws://localhost:3000?token=<jwt>`

Messages are JSON objects with `type` and `payload` fields. Supported client → server messages:

| Type | Payload | Description |
|------|---------|-------------|
| `SUBSCRIBE` | `{ roomId }` | Join a session as a viewer. |
| `SUBSCRIBE_ADMIN` | `{ roomId }` | Join a session as admin (must be owner). |
| `STROKE` | `{ sessionId, slideId, stroke }` | Broadcast a drawing stroke (admin only). |
| `CLEAR_SLIDE` | `{ sessionId, slideId }` | Clear strokes for a slide (admin only). |
| `CHAT_MESSAGE` | `{ sessionId, message }` | Send a chat message when chat is enabled. |
| `CHAT_ENABLE` | `{ sessionId, enabled }` | Toggle chat availability (admin only). |

Server → client notifications include:

- `SUBSCRIBED` – initial session snapshot `{ isAdmin, session, strokes, chatMessages }`
- `STROKE` – stroke payload for drawings
- `CLEAR_SLIDE` – slide cleared notification `{ slideId }`
- `SLIDE_CHANGED` – updated slide list `{ sessionId, currentSlideId, slides }`
- `CHAT_MESSAGE` – broadcast chat message `{ id, message, email, timestamp }`
- `CHAT_ENABLE` – chat availability changed `{ sessionId, enabled }`
- `SESSION_STARTED` / `SESSION_ENDED` – lifecycle updates
- `ERROR` – descriptive error message

## Project structure

```
.
├── prisma/
│   └── schema.prisma
├── public/
│   └── placeholders/pdf.svg
├── src/
│   ├── index.ts
│   ├── server/
│   │   ├── app.ts
│   │   ├── config/env.ts
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
│   │   │   └── session.controller.ts
│   │   ├── lib/prisma.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── errorHandler.ts
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── index.ts
│   │   │   └── session.routes.ts
│   │   └── utils/
│   │       ├── httpError.ts
│   │       ├── serializers.ts
│   │       └── sessionId.ts
│   └── ws/
│       └── server.ts
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

## Testing the APIs

Use your preferred HTTP client (curl, HTTPie, Postman, etc.) and authenticate using the JWT received from `/api/v1/signin`.

Example flow:

```bash
# Signup
curl -X POST http://localhost:3000/api/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"Password123"}'

# Signin
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"Password123"}' | jq -r '.token')

# Create session
curl -X POST http://localhost:3000/api/v1/session \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

## License

MIT
