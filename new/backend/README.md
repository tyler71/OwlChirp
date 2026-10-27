# OwlChirp backend

Go server for OwlChirp. Serves the REST API, realtime metrics over a
WebSocket (`/api/ws`), and the Astro frontend embedded from `app/assets/web`.

Run everything from the parent directory with `just` (see `../justfile`):

- `just dev` runs the backend with live reload on :4444 and Astro dev on :4321
- `just build` builds the frontend, embeds it, and builds `build/owlchirp-linux-amd64`
- `just docker` builds the container image

## Configuration

Configuration is read from environment variables. Copy `env.example` to `.env`
and fill it in. With docker compose, variables are read from `../.env` (next to
`docker-compose.yml`), not `backend/.env`.

### Required

| Variable | Description |
| --- | --- |
| `CONNECT_INSTANCE` | Amazon Connect instance ID: the UUID after `instance/` in the instance ARN (`arn:aws:connect:<region>:<account>:instance/<id>`). Used for Connect API calls and CCP. |
| `CONNECT_DOMAIN` | Connect instance access URL, e.g. `https://your-instance.my.connect.aws` (or `https://your-instance.awsapps.com`). Used by the frontend to load CCP and for login and contact-record links. It comes from the instance alias, so it can't be derived from `CONNECT_INSTANCE`. A trailing `/` is stripped. |
| `AWS_DEFAULT_REGION` | AWS region the Connect instance lives in, e.g. `us-west-2`. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials with read access to the Connect instance. Not needed when the AWS SDK default chain can find credentials another way (instance role, `~/.aws`, ...). |

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `APP_PORT` | `4444` | HTTP port the server listens on. |
| `HOST` | `0.0.0.0` | Address the server binds to. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `DEV_MODE` | `false` | Mounts the pprof profiler at `/debug`. |
| `DB_DSN` | `./_data/owlchirp.sqlite3` (`/data/owlchirp.sqlite3` in docker) | SQLite database path. The legacy `DB_STRING` variable and `sqlite+aiosqlite:///` form are still accepted. |
| `AWS_CONNECT_CACHE_LENGTH` | `10` | Seconds to cache Connect metric responses. |
| `TIME_ZONE` | `UTC` | [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) used by the frontend for call times and metrics, e.g. `America/Los_Angeles`. |
| `TELEMETRY_URL` | empty | Telemetry endpoint passed to the frontend. Empty disables telemetry. |

### Not yet used

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are reserved for web
push notifications. Generate keys with `npx web-push generate-vapid-keys`;
`VAPID_SUBJECT` is a `mailto:` or `https:` URL identifying the sender.

## WebSocket protocol

1. Connect to `/api/ws`.
2. Send `{"type":"auth","token":"<X-Api-Key>"}` within 5 seconds. A bad token closes with code 4401.
3. Receive JSON objects holding only the metric keys that changed
   (`queue_count`, `available_count`, `active_agent_count`, `user_list`, `handled_incoming`).
   The first message is a full snapshot.
