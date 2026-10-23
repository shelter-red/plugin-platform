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

When you save the plugin domain suffix under **Maintenance, domains & quotas**, the platform uses the stored Token to find the matching Zone, write the wildcard DNS record and create the Worker Route. Do not use a parent suffix that contains the console host; use `plugins.example.com` when the console is `platform.example.com`. Existing third-party DNS records or Worker Routes are preserved and reported as conflicts instead of being overwritten.

If a bad suffix makes the console return `Plugin domain not found`, open Cloudflare Dashboard → D1 → `plugmesh` → Console and run the emergency update below, replacing `plugins.example.com` with the intended plugin suffix. Then save the suffix again in the settings page so the stored Token can sync DNS and the Worker Route:

```sql
UPDATE platform_settings
SET value_json = json_set(value_json, '$.pluginDomainSuffix', '.plugins.example.com'),
    updated_at = datetime('now')
WHERE key = 'platform';
```

- `401 token_invalid`: the Token is invalid, revoked, or has passed its configured expiry date; create a new Token.
- `403 token_permission_denied`: one of the fixed permissions is missing; update the permissions or recreate the Token.
- `409 account_missing` / `409 account_ambiguous`: the Token sees no account, or sees multiple accounts; enter the target Account ID.
- `502 cloudflare_upstream_error`: Cloudflare or the network is temporarily unavailable; retry later with the single **Refresh usage** button on the usage page.

Errors stay on the current settings or usage page with the HTTP status, error code and upstream message. Free limits come only from subscriptions; until a Free plan is confirmed the UI shows “Not available” and does not accept manual limits.

### Use a binary plugin server

Download the artifact from GitHub Actions' **Manual plugin server build** workflow that matches your operating system and artifact type. `executable` contains a standalone `plugmesh-server`; `shared` is an embeddable library and is not a standalone executable. Linux artifacts include `libssl.so.3` and `libcrypto.so.3`, and Windows artifacts include the OpenSSL DLLs; source builds on macOS still require `brew install openssl@3`. Verify `SHA256SUMS` before extracting or running it: use `sha256sum -c SHA256SUMS` on Linux, `shasum -a 256 -c SHA256SUMS` on macOS, or compare `Get-FileHash` output with the file on Windows PowerShell. Do not mix a server or plugin library built for another operating system.

Arrange the plugin directory as one subdirectory per plugin. Each directory needs a `manifest.json` and a dynamic library for the target platform, for example on Linux:

```text
plugins/
└── sample.plugin/
    ├── manifest.json
    └── libsample.so
```

`manifest.json` must declare at least `id`, `name`, `version`, `abiVersion`, `library`, `healthPath`, `capabilities`, and `permissions`. `abiVersion` may be 2, 3, or 4. `library` must stay inside the plugin directory and use `.so`, `.dylib`, or `.dll` for the target platform. The artifact includes the plugin ABI header; the complete fields and callbacks are documented in `native-server/README.md`.

Generate a one-time registration code under **Plugin servers** in the console, then register the extracted server. Linux/macOS example:

```bash
PLUGMESH_CREDENTIAL_PASSWORD='local credential password' \
PLUGMESH_REGISTRATION_CODE='one-time-registration-code' \
./plugmesh-server --register https://platform.example.com 'edge-server' ~/.config/plugmesh/credentials.json
```

Windows PowerShell example:

```powershell
$env:PLUGMESH_CREDENTIAL_PASSWORD = 'local credential password'
$env:PLUGMESH_REGISTRATION_CODE = 'one-time-registration-code'
.\plugmesh-server.exe --register https://platform.example.com 'edge-server' "$env:USERPROFILE\.plugmesh\credentials.json"
```

Start the server after registration. `plugmesh-plugin-host` can be omitted from the configuration when it is next to `plugmesh-server`; otherwise set `PLUGMESH_PLUGIN_HOST`. `PLUGMESH_LOCAL_UI_DIRECTORY` only controls the local server console. The binary artifact does not include that frontend directory, so build `native-ui` separately and pass its path when you need the local UI.

```bash
PLUGMESH_CREDENTIAL_FILE="$HOME/.config/plugmesh/credentials.json" \
PLUGMESH_CREDENTIAL_PASSWORD='local credential password' \
PLUGMESH_PLUGIN_DIRECTORY="$PWD/plugins" \
PLUGMESH_PLUGIN_HOST="$PWD/plugmesh-plugin-host" \
./plugmesh-server
```

When the server is online in the console, use **Plugin instances** to load and enable the plugin, run its health check, and then assign a prefix under **Public domains**. The local server console listens on `127.0.0.1:8787` by default; use `PLUGMESH_LOCAL_PORT` to change it. `PLUGMESH_WORKER_URL`, `PLUGMESH_PLUGIN_DIRECTORY`, `PLUGMESH_PLUGIN_HOST`, `PLUGMESH_CREDENTIAL_FILE`, `PLUGMESH_CREDENTIAL_PASSWORD`, and `PLUGMESH_LOCAL_UI_DIRECTORY` can all be supplied as environment variables. Never commit an access token or credential file.

### Embed the shared library

The shared-library artifact contains the server library, `plugmesh-plugin-host`, `server_api.h`, and build notes. The host application must store credentials and pass the registered Worker URL, server ID, access token, plugin directory, and host executable path through `plugmesh_server_config`; the library does not implement `--register` or the local UI setup flow. Link the platform library (`libplugmesh-server.so`, `libplugmesh-server.dylib`, or the Windows DLL/import library) and ship the required OpenSSL 3 runtime with the application.

The minimal C ABI lifecycle is:

```c
#include "plugmesh/server_api.h"

plugmesh_server_config config = {
    "https://platform.example.com",
    "server-id",
    "access-token",
    "/opt/plugmesh/plugins",
    "/opt/plugmesh/plugmesh-plugin-host",
};
char error[256];
plugmesh_server* server = plugmesh_server_create(&config, error, sizeof(error));
if (!server || !plugmesh_server_start(server)) {
    /* Record plugmesh_server_last_error(server) or error and handle failure. */
}
/* Keep server alive while the host process is running. */
plugmesh_server_stop(server);
plugmesh_server_destroy(server);
```

`server_api.h` is the stable C ABI for C and C++ hosts; do not pass STL types across the boundary. Plugins still use the `plugin_api.h` ABI v2/v3/v4 exports. `plugmesh_server_create` copies the configuration strings, and the lifecycle must be released in `stop` then `destroy` order. Platform-specific import libraries, RPATH, OpenSSL setup, and plugin layout are documented in [`native-server/README.md`](https://github.com/shelter-red/plugin-platform/blob/main/native-server/README.md).

If no plugin is discovered, check `PLUGMESH_PLUGIN_DIRECTORY`, each subdirectory's `manifest.json`, the `library` extension, and `PLUGMESH_PLUGIN_HOST`. If health checks fail, inspect `/api/diagnostics` and `/api/logs` on the local console and verify outbound HTTPS connectivity to the Worker.

## Support scope

This repository is a self-hosted plugin platform and does not provide a hosted service. Include access logs, audit logs and deployment details when reporting issues.
