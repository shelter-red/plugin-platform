### Data we store

- Administrator credential: the password is stored only as a salted PBKDF2-derived value and is used for sign-in and authorization.
- Sessions: an HttpOnly cookie holds the session identifier; only its hash is stored server-side.
- Runtime data: server heartbeats, plugin manifests, public request logs and audit events.
- Configuration: SMTP passwords and the Cloudflare Global API Key are encrypted with AES-GCM before being written to D1; secret values are never returned by GET APIs.

### Local plugin servers

The executable and shared-library plugin servers run on your machine or inside your host process. Plugin libraries, `manifest.json` files, local logs and credential files are handled locally; the server opens a control connection to the platform and forwards the data needed for public plugin requests. After registration, the access token is stored in the system credential store or in a password-protected AES-GCM encrypted file, and is not written to the repository. In shared-library mode the host application owns and supplies the credentials; restrict the plugin directory and local management port according to your deployment policy.

### How data is used

Only for authentication, request routing, usage accounting, auditing and maintenance notifications.

### Retention

- Access logs: 30 days.
- Audit logs: 180 days.
- Expired sessions, registration codes and temporary objects are removed by scheduled maintenance.

### Third parties

- Cloudflare: Workers, D1, R2 and account usage queries plus plugin-domain configuration through the account email and Global API Key.
- Your SMTP provider: test messages and maintenance notifications.

### Your choices

Sign out from the account page. Operators can delete D1 and R2 data at any time.
