# TypeScript Express Backend Scaffold

This repository provides a minimal, production-ready scaffold for a Node.js backend using TypeScript, Express, Jest, ESLint, and Prettier.

## Features

- TypeScript-based Express server
- ts-node-dev for fast local development
- Centralized error handling and minimal logger
- Request logging middleware
- Success/error JSON response helpers
- dotenv-based configuration loader with validation
  - Validates required env vars: `DATABASE_URL`, `JWT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Jest testing setup
- ESLint + Prettier
- Health check endpoint at `GET /health`

## Getting Started

1. Install dependencies

   ```bash
   npm install
   # or
   yarn install
   ```

2. Create an `.env` file in the project root:

   ```bash
   cp .env.example .env
   ```

   Or create it manually with at least the following variables:

   ```env
   NODE_ENV=development
   PORT=3000
   DATABASE_URL=postgres://user:pass@localhost:5432/dbname
   JWT_SECRET=change_me_to_a_secure_secret_value
   AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
   AWS_REGION=us-east-1
   ```

3. Run the development server

   ```bash
   npm run dev
   ```

   The server will start on `http://localhost:3000` by default.

4. Health check

   ```bash
   curl http://localhost:3000/health
   ```

## Scripts

- `npm run dev` - Start dev server with ts-node-dev
- `npm run build` - Compile TypeScript to JavaScript into `dist/`
- `npm start` - Start compiled server from `dist/`
- `npm test` - Run Jest tests
- `npm run lint` - Lint the codebase
- `npm run format` - Check formatting with Prettier

## Project Structure

```
src/
  app.ts                 # Express app setup
  server.ts              # Server bootstrap
  routes/
    index.ts             # Route definitions
  controllers/
    health.controller.ts # Health check controller
  middlewares/
    logger.ts            # Request logging middleware
    errorHandler.ts      # Centralized error handling
    notFound.ts          # 404 handler
  config/
    env.ts               # dotenv configuration and validation
  utils/
    logger.ts            # Minimal console logger
    response.ts          # Success/error response helpers
```

## Notes

- The configuration loader validates the presence of required environment variables at startup and will throw an error if any are missing or invalid.
- Logging is intentionally minimal and dependency-free; replace with your preferred logger (e.g., pino, winston) as needed.
- Extend routes, controllers, services, middlewares, and utils per your application's needs.
