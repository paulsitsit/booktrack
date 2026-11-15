# Shelfwise Library System — MongoDB Atlas + Separate Deployments

This version keeps the original Shelfwise black-and-gold visual theme, React/Vite dashboard layout, and existing Express API workflows, while moving persistence from SQLite to MongoDB Atlas and separating the frontend and backend into independent deployable applications. The only additional interface is the Admin-only Staff accounts page and role-aware account identity.

## Project structure

```text
Shelfwise-Library-System/
├── frontend/                 # React + TypeScript + Vite (deploy to Vercel)
│   ├── src/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
├── backend/                  # Express + Mongoose API (deploy to Render)
│   ├── src/index.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
└── README.md
```

## What stays the same

- Existing Shelfwise React UI and styling.
- Administrator and librarian login with role-based protected API routes.
- Admin-only staff management: create librarian accounts and activate/deactivate them.
- Librarians can operate books, students, loans, returns, and reminders but cannot manage staff accounts or system settings.
- Book list, search, status filters, and dashboard statistics.
- Student records and editing.
- Borrowing and returning books, including the existing manual student/book entry behavior.
- Due-date and overdue calculations, 15-day penalty grace period, and 5-per-day penalty calculation.
- Upcoming due-date notifications and optional SMTP/Twilio reminders.
- Guardrails against deleting books that have loan history and bulk deletion.

MongoDB document IDs are now returned as strings. The frontend accepts both string IDs from MongoDB and numeric IDs in its local demo placeholders.

## 1. Create MongoDB Atlas database

1. Create a free MongoDB Atlas cluster.
2. Create a database user with read/write access to the library database.
3. In **Network Access**, allow the Render backend to connect. For initial testing you may temporarily allow `0.0.0.0/0`; for production, restrict access where your hosting/network setup permits.
4. Choose **Connect → Drivers**, copy the Node.js connection string, replace the username/password placeholders, and use the database name `shelfwise`.
5. URL-encode special characters in the database username/password before placing them in the URI.

Example shape (not a real credential):

```text
mongodb+srv://<db_username>:<db_password>@<cluster-host>/shelfwise?retryWrites=true&w=majority
```

The backend creates the `books`, `students`, `loans`, and `users` collections and indexes automatically. On first startup it creates the administrator account from `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` if that email does not already exist. Create additional librarian accounts from the Admin dashboard under Staff accounts. The staff list shows librarian accounts only; the initial administrator remains managed through the backend environment and cannot be deactivated from that screen. MongoDB Atlas supports the replica-set transactions used to make borrowing atomic.

## 2. Run locally

### Backend terminal

```bash
cd backend
npm install
```

Copy `backend/.env.example` to `backend/.env` and set:

- `MONGODB_URI`
- `ADMIN_NAME` (optional; defaults to Library Administrator)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (at least 12 characters)
- `SESSION_SECRET` (at least 32 random characters)
- `FRONTEND_ORIGIN=http://localhost:5173`

Start the API:

```bash
npm run dev
```

The API listens on `http://localhost:3002` by default.

### Frontend terminal

```bash
cd frontend
npm install
```

For local development, you can leave `VITE_API_URL` unset; Vite proxies `/api` to `http://localhost:3002`. Or copy `.env.example` to `.env` and use `VITE_API_URL=http://localhost:3002/api`.

Start the UI:

```bash
npm run dev
```

Open `http://localhost:5173`.

## 3. Deploy backend to Render

Create a **Web Service** from the repository:

- Root Directory: `backend`
- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm start`

Set these Render environment variables:

```text
NODE_ENV=production
MONGODB_URI=<your Atlas connection string>
ADMIN_NAME=Library Administrator
ADMIN_EMAIL=<your admin email>
ADMIN_PASSWORD=<a strong unique password of at least 12 characters>
SESSION_SECRET=<a unique random value at least 32 characters>
FRONTEND_ORIGIN=https://<your-vercel-domain>
```

Add SMTP/Twilio environment variables only if you use email/SMS reminders. Do not put the Atlas URI, admin password, or session secret in the frontend.

After deployment, verify:

```text
https://<your-render-service>.onrender.com/api/health
```

The response should show `ok: true` and `database: "connected"`.

## 4. Deploy frontend to Vercel

Import the same repository as a separate Vercel project:

- Root Directory: `frontend`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

Set this Vercel environment variable:

```text
VITE_API_URL=https://<your-render-service>.onrender.com/api
```

Redeploy the frontend after setting or changing this variable. Then update Render's `FRONTEND_ORIGIN` to the exact deployed Vercel origin (no `/api` path). If you use a custom domain, set that origin too.

## 5. Existing data and migration

This package does not include the old SQLite database file, so there are no local SQLite records to import from the supplied source archive. The MongoDB database starts with empty collections and preserves the same application workflows. Do not expect old SQLite records to appear automatically. If you have a separate `library.db` containing real records, back it up and request a data import before switching production traffic.

## Important operational notes

- MongoDB Atlas credentials are backend-only secrets.
- Borrowing uses a MongoDB transaction and therefore requires an Atlas replica-set deployment (Atlas clusters provide this).
- The backend enforces one active loan per book and one active loan per student with partial unique indexes.
- Admin and librarian sessions are signed bearer tokens that expire after eight hours. The backend checks the current account and active status on every protected request. Only admins can create or deactivate librarian accounts.
- Email and SMS reminders are optional and require their respective credentials.
- Do not commit either `.env` file.

## Verification

The TypeScript/TSX source was syntax-transpiled during preparation. Full dependency installation, TypeScript type-checking, build, MongoDB Atlas connection, and end-to-end browser tests still need to be run in an environment with package-registry access and a configured Atlas URI. No live database credentials are included in this ZIP.
