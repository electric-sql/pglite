# Example: PGlite + Vite + React + TypeScript

This is an example of a simple project using [PGlite](https://pglite.dev) and it's [React integration](https://pglite.dev/docs/framework-hooks/react). It uses [Vite](https://vite.dev), [React](https://react.dev/) and [TypeScript](https://www.typescriptlang.org/).

This example demonstrates the usage of some of PGlite's React API: [PGliteProvider](https://pglite.dev/docs/framework-hooks/react#pgliteprovider), [usePGlite](https://pglite.dev/docs/framework-hooks/react#usepglite), [useLiveQuery](https://pglite.dev/docs/framework-hooks/react#uselivequery).

On page load, a database is created with a single table. On pressing the button, a new row is inserted into the database. The `useLiveQuery` will watch for any changes and display the most recently inserted 5 rows.

# Getting started with this example

## Prerequisites
You need [node](https://nodejs.org/en/download) (at least version 18), [pnpm](https://pnpm.io/installation) and [git](https://git-scm.com/downloads) installed.

Check node version
```
$ node --version
```
Sample output: `v20.9.0`

Check pnpm version
```
$ pnpm --version
```
Sample output: `9.15.3`

Check git version
```
$ git --version
```
Sample output: `git version 2.34.1`

## Install and run the example locally

This example depends on `PGlite` packages released on npmjs.com, so you don't need to build the entire `PGlite` project in order to run the example.

1. Get the code from GitHub. The example is in `PGlite`'s main repository
```
$ git clone https://github.com/electric-sql/pglite
```
2. Navigate to this example's directory
```
$ cd ./pglite/examples/react
```
3. Install dependencies

```
$ pnpm i --ignore-workspace
```

This example is part of the `pglite` pnpm workspace, but for our needs, we do not need to install all dependencies in the workspace. Thus passing the `--ignore-workspace` flag.

4. Start a development server locally
```
$ pnpm dev
```
Sample output:
```
  VITE v6.1.0  ready in 126 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

5. Open your browser and point to the above indicated address (http://localhost:5173/ but your address might be different)

# Getting started with PGlite + Vite + React + Typescript

If you'd like to start from scratch, here is how you can reproduce this example, so you understand better how it was made:

1. Install node
2. Install pnpm
3. 

