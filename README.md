# Intelligence Query Engine

A Profile Intelligence Service API that stores and queries demographic profiles with advanced filtering, sorting, pagination, and natural language search.

## Live URL
https://intelligence-query-engine-green.vercel.app

## Endpoints

### POST /api/profiles
Creates a new profile by enriching a name using Genderize, Agify, and Nationalize APIs.
**Body:** `{ "name": "John" }`

### GET /api/profiles
Returns all profiles with filtering, sorting, and pagination.

**Filters:** `gender`, `country_id`, `age_group`, `min_age`, `max_age`, `min_gender_probability`, `min_country_probability`

**Sorting:** `sort_by=age|created_at|gender_probability` + `order=asc|desc`

**Pagination:** `page=1&limit=10` (max limit: 50)

**Example:** `/api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc`

### GET /api/profiles/search
Natural language query search.
**Example:** `/api/profiles/search?q=young males from nigeria`

### GET /api/profiles/:id
Returns a single profile by ID.

### DELETE /api/profiles/:id
Deletes a profile. Returns 204 No Content.

## Tech Stack
- Node.js + Express
- PostgreSQL (Neon)
- UUID v7
# Insighta Labs+ Backend

Secure REST API for the Insighta Labs demographic intelligence platform.

## Live URL
https://intelligence-query-engine-green.vercel.app

## System Architecture
- Backend: Node.js + Express
- Database: PostgreSQL (Neon)
- Auth: GitHub OAuth + JWT tokens
- Deployment: Vercel

## Authentication Flow
1. User visits `/auth/github` → redirected to GitHub
2. GitHub redirects back with code
3. Backend exchanges code for GitHub token
4. Backend retrieves user info from GitHub
5. Backend creates/updates user in database
6. Backend issues access token (3 min) + refresh token (7 days)

## Token Handling
- Access token: JWT, expires in 3 minutes
- Refresh token: UUID, expires in 7 days
- Old refresh token invalidated on each refresh

## Role Enforcement
- `admin` — can create and delete profiles, full access
- `analyst` — read-only access to profiles
- Default role: `analyst`
- Enforced via middleware on all `/api/*` endpoints

## Natural Language Parsing
Rule-based parsing converts English queries to SQL filters:
- "young" → age 16–24
- "males/females" → gender filter
- "from nigeria" → country_id=NG
- "above 30" → min_age=30
- "adult/senior/child/teenager" → age_group filter

## API Endpoints

### Auth
- `GET /auth/github` — redirect to GitHub OAuth
- `GET /auth/github/callback` — handle OAuth callback
- `POST /auth/refresh` — refresh tokens
- `POST /auth/logout` — invalidate refresh token

### Profiles (require auth + X-API-Version: 1)
- `GET /api/profiles` — list with filters, sorting, pagination
- `GET /api/profiles/search?q=` — natural language search
- `GET /api/profiles/:id` — get single profile
- `POST /api/profiles` — create profile (admin only)
- `DELETE /api/profiles/:id` — delete profile (admin only)
- `GET /api/profiles/export` — export CSV

### Users
- `GET /api/users/me` — get current user

## Rate Limiting
- Auth endpoints: 10 req/min
- API endpoints: 60 req/min per user

## Headers Required
All `/api/*` requests need:
- `Authorization: Bearer <access_token>`
- `X-API-Version: 1`