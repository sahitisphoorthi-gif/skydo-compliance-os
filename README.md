# Skydo Compliance OS — Full Stack MySQL Edition

This package keeps the supplied Skydo Compliance OS frontend/content and adds a real Node.js/Express API backed by MySQL. It is designed for a split deployment: the static frontend can be published to GitHub Pages and the API/database can run on a server platform such as Railway.

## Architecture

- Frontend: existing HTML/CSS/JavaScript application
- Static hosting: GitHub Pages
- Backend: Node.js 22 + Express
- Database: MySQL 8+
- Authentication: JWT + bcrypt password hashing
- Authorization: admin / analyst / viewer roles
- Documents: multipart upload to backend storage
- Security: Helmet, CORS, rate limiting, audit log
- Integrations: configurable HTTP adapters for Compliance Portal, Metabase, Zoho Desk, IDFY and Fravity

## Local setup

1. Install Node.js 22 LTS.
2. Install/start MySQL 8+.
3. Create a database named `compliance_os` and a user with access to it, or use Docker Compose.
4. Copy `.env.example` to `.env`.
5. Set `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` and a strong `JWT_SECRET`.
6. Run `npm install`.
7. Run `npm run init-db`.
8. Run `npm start`.
9. Open `http://localhost:3000`.

Default development administrator:

- Email: `admin@skydo.local`
- Password: `ChangeMe123!`

Change this password immediately.

## Docker local setup

```bash
docker compose up --build
```

The compose file starts MySQL and the API. The first API startup initializes the schema and default admin.

## GitHub Pages frontend

Before publishing the `public` folder, edit `public/config.js`:

```js
window.COMPLIANCE_OS_CONFIG = {
  API_BASE_URL: 'https://YOUR-BACKEND-DOMAIN'
};
```

Do not put database passwords, JWT secrets, or private API keys in this file. The value is public browser configuration.

A GitHub Actions workflow should publish only `public/` to GitHub Pages. The backend and MySQL must run separately.

## Railway backend

Create a Railway project with:

1. A MySQL service.
2. A Node service connected to this GitHub repository.
3. Backend environment variables:
   - `NODE_ENV=production`
   - `JWT_SECRET=<long random secret>`
   - `CORS_ORIGIN=https://YOUR_USERNAME.github.io/skydo-compliance-os`
   - `UPLOAD_DIR=/app/uploads`
   - MySQL variables supplied by the Railway MySQL service: `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`.

The API starts with `npm start`. Run `npm run init-db` once after the MySQL service is available, or use a deployment/release command that initializes the schema before starting the API.

For persistent documents, attach persistent storage or replace local upload storage with an approved object-storage provider. Do not rely on an ephemeral application filesystem for production documents.

## API

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET/POST /api/users`
- `GET/POST/PATCH /api/tickets`
- `GET/POST/PATCH /api/ubos`
- `POST /api/documents`
- `GET /api/documents`
- `GET /api/documents/:id/download`
- `GET/POST/DELETE /api/saved-items`
- `POST/GET /api/quiz/attempts`
- `GET /api/audit`
- `GET /api/integrations`
- `/api/integrations/:name/*path`
- `GET /api/health`

## External integrations

The integration layer intentionally does not invent private API endpoints or credentials. Configure the official endpoint, authentication method and scopes for each supported system before enabling it.

Never expose these secrets in GitHub Pages frontend code:

- Compliance Portal API keys
- Metabase API keys
- Zoho Desk tokens
- IDFY API keys
- Fravity API keys
- JWT signing secret
- MySQL credentials

## Production checklist

- Use HTTPS.
- Use a strong random JWT secret.
- Restrict CORS to the exact GitHub Pages origin.
- Use SSO/OIDC if required by the organization.
- Use persistent encrypted document storage.
- Enable MySQL backups.
- Add malware scanning and file-type validation for uploads.
- Add retention policies and monitoring.
- Configure the actual official integration APIs and webhooks.
- Change/remove the default development administrator.
