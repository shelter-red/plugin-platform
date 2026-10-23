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

### What if the Cloudflare API Token cannot read usage?

Open **Settings → Cloudflare** and use the **Create API Token** link. Fill the three Cloudflare dropdowns for each fixed permission: scope, permission group and level.

| Scope | Permission group | Level |
| --- | --- | --- |
| Account | Account Settings | Read |
| Account | Account Analytics | Read |
| Account | Billing | Read |
| Zone | Zone | Read |
| Zone | DNS | Write |
| Zone | Workers Routes | Edit |

Choose the target account under **Account**, the plugin domain's Zone under **Zone**, and nothing under **User**. The platform verifies the Token, lists visible accounts and reads subscriptions before saving. The Account ID field only selects a target when the Token can see multiple accounts. The settings page reports each permission as verified, missing or not tested.

When you save the plugin domain suffix under **Maintenance, domains & quotas**, the platform uses the stored Token to find the matching Zone, write the wildcard DNS record and create the Worker Route. Existing third-party DNS records or Worker Routes are preserved and reported as conflicts instead of being overwritten.

- `401 token_invalid`: the Token is invalid, revoked, or has passed its configured expiry date; create a new Token.
- `403 token_permission_denied`: one of the fixed permissions is missing; update the permissions or recreate the Token.
- `409 account_missing` / `409 account_ambiguous`: the Token sees no account, or sees multiple accounts; enter the target Account ID.
- `502 cloudflare_upstream_error`: Cloudflare or the network is temporarily unavailable; retry later with the single **Refresh usage** button on the usage page.

Errors stay on the current settings or usage page with the HTTP status, error code and upstream message. Free limits come only from subscriptions; until a Free plan is confirmed the UI shows “Not available” and does not accept manual limits.

## Support scope

This repository is a self-hosted plugin platform and does not provide a hosted service. Include access logs, audit logs and deployment details when reporting issues.
