To install dependencies:

```sh
bun install
```

To run:

```sh
bun run dev
```

open http://localhost:3000

To run with Docker for development:

```sh
docker compose up --build api
```

The development stack starts Postgres, RustFS, runs database migrations, and starts the API with hot reload.

Useful URLs:

- API health: http://localhost:3000/health
- RustFS console: http://localhost:9001
