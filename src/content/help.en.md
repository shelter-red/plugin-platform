## Getting started

1. After the first deployment open `/setup` and provide the setup token to store your GitHub OAuth App credentials.
2. Sign in with GitHub. Only invited identities are allowed in.
3. Generate a one-time registration code under "Plugin servers" and run `plugmesh-server --register <code>` on the server.
4. Once the server is online, load and enable plugins under "Plugin instances".
5. After the health check passes, assign a prefix under "Public domains" and the public entry point is live.

## Everyday actions

- **Theme and language**: the topbar dropdowns apply immediately and persist locally.
- **Search and jump**: press ⌘K / Ctrl+K to search pages, settings sections, servers, plugins, domains, access logs and audit events.
- **Export logs**: access and audit pages export CSV with a UTF-8 BOM.
- **Maintenance mode**: pause public entry points under "Settings → Maintenance, domains and quotas"; public requests receive the maintenance page.

## FAQ

### Why is the server always offline?

The server must reach the Worker over an outbound connection. Check that the registration code was not reused, the clock is accurate, and the control connection is not blocked by a firewall.

### Why can't I assign a domain?

Domains can only be assigned to enabled plugins that pass the health check. Prefixes must be unique and avoid reserved names.

### What if Cloudflare authorization fails?

The authorization card shows diagnostics: `access_denied` means access was denied on the consent page, `invalid_client` means the client ID or secret does not match.

## Support scope

This repository is a self-hosted plugin platform and does not provide a hosted service. Include access logs, audit logs and deployment details when reporting issues.
