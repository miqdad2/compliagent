# Security

The platform is designed for confidential technical documents.

- Supabase Row Level Security enforces organization isolation.
- Storage buckets are private.
- Server-side permission checks are required for mutations.
- Secrets remain server-side and are represented only in `.env.example`.
- Full document text and secrets must not be logged.
- AI provider use is configuration-driven and must be transparent to the organization.
