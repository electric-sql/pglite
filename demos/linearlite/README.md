# Linearlite

## Setup

1. Make sure you've installed all dependencies for the monorepo and built packages

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Start the docker containers

`pnpm run backend:up`

3. Start the dev server

`pnpm run dev`

4. When done, tear down the backend containers so you can run other examples

`pnpm run backend:down`
