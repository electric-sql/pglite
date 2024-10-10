# Linearlite + PGlite + ElectricSQL

## Setup

1. Make sure you've installed all dependencies for the monorepo and built packages

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Add a `.env` file with the following (or similar):

```
DATABASE_URL=postgresql://postgres:password@localhost:54321/linearlite
VITE_ELECTRIC_URL=http://localhost:3000
VITE_WRITE_SERVER_URL=http://localhost:3001
```

3. Start the docker containers

`pnpm run backend:up`

4. Start the write path server

`pnpm run write-server`

5. Start the dev server

`pnpm run dev`

5. When done, tear down the backend containers

`pnpm run backend:down`
