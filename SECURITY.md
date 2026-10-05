# Security and privacy notes

This app handles sensitive financial data. SQLite is the operational store; cloud sync and AI features must remain optional, owner-scoped, and explicit.

## AI credentials

The app does not bundle a shared ShopAIKey credential. Each user may enter a personal key; it is stored with Expo SecureStore and can be removed from Settings. For a broadly distributed production release, an authenticated server-side proxy with per-user authorization, rate limits, key rotation, and abuse monitoring remains preferable. Never commit provider credentials or service-account keys.

## AI data handling

- Run deterministic local parsing and learned rules before considering AI.
- Obtain explicit user consent before sending financial text, audio, images, or notification-derived data to an AI provider.
- Send only the minimum required fields. Redact account/card numbers, transaction references, balances, personal identifiers, and unrelated notification content locally.
- Validate AI output against local categories and numeric constraints. AI must not calculate ledger balances or silently save a financial record.
- AI-derived and notification-derived transactions require user review when confidence is uncertain.
- Do not place prompts, notification bodies, credentials, tokens, or financial payloads in production logs.

## Bank notifications and sync

Notification access must be opt-in and limited to an allowlist. Raw notification retention should be local, encrypted where practical, time-bounded, and documented. Deduplication identifiers should not expose raw notification text.

Firestore documents must remain under `users/{uid}` with owner-only rules. New collections require Firebase Emulator allow/deny tests, including cross-user denial, before deployment. Never delete or recreate user collections as a migration shortcut.
