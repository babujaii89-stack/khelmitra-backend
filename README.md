# KhetMitra standalone API

Deploy this folder as a separate Node.js 20+ web service (Render, Railway, Fly.io, VPS, etc.). It is independent of the TanStack frontend.

## Run locally

```bash
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and optional data.gov.in key
npm start
```

The service listens on `PORT` (default 8080). `GET /health` is public. All `/api/*` routes require `Authorization: Bearer <Supabase access token>` and use the farmer's JWT against Supabase REST, so existing Row Level Security remains in force. No service-role key is required or exposed.

## Routes
- `POST /api/crop-advice` — saved farm profile + season-based crop ranking.
- `POST /api/crop-validation` — validates `{ "cropId": "tomato" }` against soil, season and rotation.
- `POST /api/mandi-prices` — `{ "district": "...", "state": "...", "crops": ["Tomato"] }`.
- `POST /api/fertilizer-plan` — crop-specific day-by-day schedule from the saved active crop and soil profile.

Set `ALLOWED_ORIGIN` to the exact deployed frontend origin. Configure the data.gov.in key to enable live market quotes; without it the API explicitly returns unavailable prices rather than fabricated values.

## Supabase schema
Uses existing `profiles` fields only: `id`, `farm_profile`, `onboarded`, `active_crop_id`, and `tasks`. No migration is included or required. Ensure the existing `profiles` RLS policy allows a signed-in user to select only their own row.
