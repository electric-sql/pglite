import { describe, it, beforeEach, afterEach } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('db triggers', () => {
  let db
  let eventTarget

  beforeEach(async () => {
    db = await PGlite.create()
    eventTarget = new EventTarget()
    await db.listen('messages', (event) =>
      eventTarget.dispatchEvent(new Event(event)),
    )
  })

  afterEach(() => {
    db.unlisten('messages')
  })

  describe('regular triggers', () => {
    it('should detect insert on table', async () => {
      const eventType = `table changed`
      await db.exec(`
CREATE EXTENSION IF NOT EXISTS plpgsql;
      CREATE TABLE foo_table (id TEXT, value TEXT);

      CREATE OR REPLACE FUNCTION foo() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('messages', '${eventType}');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE TRIGGER table_trigger
      AFTER INSERT OR UPDATE OR DELETE ON foo_table
      EXECUTE FUNCTION foo();
    `)

      db.query(`INSERT INTO foo_table (id, value) VALUES ('foo', 'bar');`)
      await new Promise((resolve) =>
        eventTarget.addEventListener(eventType, resolve, { once: true }),
      )
    })
  })

  describe('event triggers', () => {
    it('should detect ddl_command_end', async () => {
      const eventType = `table created or dropped`
      await db.exec(`
CREATE EXTENSION IF NOT EXISTS plpgsql;
      CREATE OR REPLACE FUNCTION foo() RETURNS event_trigger AS $$
      BEGIN
        PERFORM pg_notify('messages','${eventType}');

      END;
      $$ LANGUAGE plpgsql;

      CREATE EVENT TRIGGER ddl_trigger
      ON ddl_command_end
      EXECUTE FUNCTION foo();
    `)

      db.exec(`CREATE TABLE foo_table (id TEXT, value TEXT);`)
      await new Promise((resolve) =>
        eventTarget.addEventListener(eventType, resolve, { once: true }),
      )

      db.exec(`DROP TABLE foo_table;`)
      await new Promise((resolve) =>
        eventTarget.addEventListener(eventType, resolve, { once: true }),
      )
    })

    it('should detect ddl_command_start', async () => {
      const eventType = `table created or dropped`
      await db.exec(`
CREATE EXTENSION IF NOT EXISTS plpgsql;
      CREATE OR REPLACE FUNCTION foo() RETURNS event_trigger AS $$
      BEGIN
        PERFORM pg_notify('messages','${eventType}');

      END;
      $$ LANGUAGE plpgsql;

      CREATE EVENT TRIGGER ddl_trigger
      ON ddl_command_start
      EXECUTE FUNCTION foo();
    `)

      db.exec(`CREATE TABLE foo_table (id TEXT, value TEXT);`)
      await new Promise((resolve) =>
        eventTarget.addEventListener(eventType, resolve, { once: true }),
      )

      db.exec(`DROP TABLE foo_table;`)
      await new Promise((resolve) =>
        eventTarget.addEventListener(eventType, resolve, { once: true }),
      )
    })

    it('should detect sql_drop', async () => {
      const eventType = `table  dropped`
      await db.exec(`
CREATE EXTENSION IF NOT EXISTS plpgsql;
      CREATE OR REPLACE FUNCTION foo() RETURNS event_trigger AS $$
      BEGIN
        PERFORM pg_notify('messages','${eventType}');

      END;
      $$ LANGUAGE plpgsql;

      CREATE EVENT TRIGGER ddl_trigger
      ON sql_drop
      EXECUTE FUNCTION foo();
    `)

      db.exec(`CREATE TABLE foo_table (id TEXT, value TEXT);`)
      // -> Should NOT fire the event trigger
      await new Promise((resolve, reject) => {
        eventTarget.addEventListener(eventType, reject, { once: true })
        setTimeout(resolve, 500)
      })

      db.exec(`DROP TABLE foo_table;`)
      await new Promise((resolve) =>
        eventTarget.addEventListener(eventType, resolve, { once: true }),
      )
    })
  })
})
