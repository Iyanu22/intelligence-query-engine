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