# Linearlite + PGlite + ElectricSQL

This is a demo app that shows how to build a local-first app using PGlite and the ElectricSQL sync engine.

It's an example of a team collaboration app such as Linear built using ElectricSQL - a sync engine that synchronises little subsets of your Postgres data into local apps and services. So you can have the data you need, in-sync, wherever you need it.

It's built on top of the excellent clone of the Linear UI built by [Tuan Nguyen](https://github.com/tuan3w).

## Setup

1. Make sure you've installed all dependencies for the monorepo and built all packages.

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Add a `.env` file with the following (or similar), in this directory:

```
DATABASE_URL=postgresql://postgres:password@localhost:54321/linearlite
VITE_ELECTRIC_URL=http://localhost:3000
VITE_WRITE_SERVER_URL=http://localhost:3001
```

3. Start the docker containers:

`pnpm run backend:up`

4. Start the write path server:

`pnpm run write-server`

5. Start the dev server:

`pnpm run dev`

5. When done, tear down the backend containers:

`pnpm run backend:down`

## How it works

LinearLite demonstrates a local-first architecture using ElectricSQL and PGlite. Here's how the different pieces fit together:

### Backend Components

1. **Postgres Database**: The source of truth, containing the complete dataset.

2. **Electric Sync Service**: Runs in front of Postgres, managing data synchronization from it to the clients. Preduces replication streams for a subset of the database called "shapes".

3. **Write Server**: A simple HTTP server that handles write operations, applying them to the Postgres database.

### Frontend Components

1. **PGlite**: An in-browser database that stores a local copy of the data, enabling offline functionality and fast queries.

2. **PGlite + Electric Sync Plugin**: Connects PGlite to the Electric sync service and loads the data into the local database.

3. **React Frontend**: A Linear-inspired UI that interacts directly with the local database.
