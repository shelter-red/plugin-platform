### Data we store

- GitHub identity: `github_id`, display name and verified email, used for sign-in and authorization.
- Sessions: an HttpOnly cookie holds the session identifier; only its hash is stored server-side.
- Runtime data: server heartbeats, plugin manifests, public request logs and audit events.
- Configuration: OAuth clients plus SMTP and Cloudflare credentials, encrypted with AES-GCM before being written to D1.

### How data is used

Only for authentication, request routing, usage accounting, auditing and maintenance notifications.

### Retention

- Access logs: 30 days.
- Audit logs: 180 days.
- Expired sessions, OAuth state, registration codes and temporary objects are removed by scheduled maintenance.

### Third parties

- GitHub: OAuth sign-in.
- Cloudflare: Workers, D1, R2 and account usage queries.
- Your SMTP provider: invite and maintenance emails.

### Your choices

Sign out from the account page. Operators can delete D1 and R2 data at any time.
