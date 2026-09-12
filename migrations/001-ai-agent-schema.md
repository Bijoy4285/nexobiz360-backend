# 001 AI Agent Schema

The backend uses a JSON-file datastore instead of SQL migrations.

This migration is applied automatically by `backend/lib/db.js` when the server boots.

## Added collections

- `tickets`
- `ticket_messages`
- `incidents`
- `ai_actions`
- `alerts`
- `system_logs`
- `monitoring_events`
- `customer_context`
- `escalation_queue`
- `jobs`
- `services`

## Notes

- Existing auth and storage collections remain intact.
- The schema normalizer upgrades old `db.json` files in place.
- No destructive migration is performed automatically.
