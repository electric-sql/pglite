# PGlite Electric Sync Example

To run the electric server:

```
docker compose up
```

And start a http server in the `./packages` dir:

```sh
python3 -m http.server
```

Open `http://localhost:8000/pglite-sync/example/index.html`.

Then connect with `psql` and insert, update, or delete rows in 
the `test` table.

```sh
psql -h localhost -p 5432 -U postgres -d postgres
```

```sql
INSERT INTO test (name) VALUES ('Hello, World!');
UPDATE test SET name = 'Hello, Electric!' WHERE id = 1;
DELETE FROM test WHERE id = 1;
```
