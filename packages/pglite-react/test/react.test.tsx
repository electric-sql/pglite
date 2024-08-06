import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { PGlite } from "@electric-sql/pglite";
import { live, PGliteWithLive } from "@electric-sql/pglite/live";
import { PGliteProvider, usePGlite, useLiveQuery } from "../dist/index.js";

describe("react", () => {
  describe("usePGlite", () => {
    it("can receive PGlite", async () => {
      const db = await PGlite.create({
        extensions: {
          live,
        },
      });
      const wrapper = ({ children }: { children: React.ReactNode }) => {
        return <PGliteProvider db={db}>{children}</PGliteProvider>;
      };

      const { result } = renderHook(() => usePGlite(), { wrapper });

      await waitFor(() => expect(result.current).toBe(db));
    });
  });

  describe("useLiveQuery", () => {
    let db: PGliteWithLive;
    let wrapper: ({
      children,
    }: {
      children: React.ReactNode;
    }) => React.ReactElement;
    beforeEach(async () => {
      db = await PGlite.create({
        extensions: {
          live,
        },
      });
      wrapper = ({ children }) => {
        return <PGliteProvider db={db}>{children}</PGliteProvider>;
      };

      await db.exec(`
        CREATE TABLE IF NOT EXISTS test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `);
      await db.exec(`TRUNCATE test;`);
    });

    it("can receive initial results", async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`);

      const { result } = renderHook(
        () => useLiveQuery(`SELECT * FROM test`, []),
        { wrapper },
      );

      await waitFor(() => expect(result.current).not.toBe(undefined));
      expect(result.current).toEqual({
        rows: [
          {
            id: 1,
            name: "test1",
          },
          {
            id: 2,
            name: "test2",
          },
        ],
        fields: [
          {
            name: "id",
            dataTypeID: 23,
          },
          {
            name: "name",
            dataTypeID: 25,
          },
        ],
      });
    });

    it("can receive changes", async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`);

      const { result } = renderHook(
        () => useLiveQuery(`SELECT * FROM test`, []),
        { wrapper },
      );

      await waitFor(() => expect(result.current?.rows).toHaveLength(2));

      // detect new inserts
      db.exec(`INSERT INTO test (name) VALUES ('test3');`);
      await waitFor(() => expect(result.current?.rows).toHaveLength(3));
      expect(result.current?.rows[2]).toEqual({
        id: 3,
        name: "test3",
      });

      // detect deletes
      db.exec(`DELETE FROM test WHERE name = 'test1';`);
      await waitFor(() => expect(result.current?.rows).toHaveLength(2));
      expect(result.current?.rows).toEqual([
        {
          id: 2,
          name: "test2",
        },
        {
          id: 3,
          name: "test3",
        },
      ]);

      // detect updates
      db.exec(`UPDATE test SET name='foobar' WHERE name = 'test2';`);
      await waitFor(() =>
        expect(result.current?.rows).toEqual([
          {
            id: 3,
            name: "test3",
          },
          {
            id: 2,
            name: "foobar",
          },
        ]),
      );

      // // detect truncates
      // db.exec(`TRUNCATE test;`)
      // await waitFor(() => expect(result.current?.rows).toHaveLength(0))
    });

    it.only("updates when query changes", async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`);

      const { result, rerender } = renderHook(
        (props) => useLiveQuery(props.query, []),
        { wrapper, initialProps: { query: `SELECT * FROM test` } },
      );

      await waitFor(() => expect(result.current?.rows).toHaveLength(2));

      rerender({ query: `SELECT * FROM test WHERE name = 'test1'` });

      // await waitFor(() => expect(result.current?.rows).toHaveLength(1));
    });

    it.skip("updates when query parameter changes", async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`);

      // console.log(await db.query(`SELECT * FROM test WHERE name = $1;`, ['test1']))

      const { result, rerender } = renderHook(
        (props) =>
          useLiveQuery(`SELECT * FROM test WHERE name = $1;`, props.params),
        { wrapper, initialProps: { params: ["test1"] } },
      );

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
          {
            id: 1,
            name: "test1",
          },
        ]),
      );

      rerender({ params: ["test2"] });

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
          {
            id: 2,
            name: "test2",
          },
        ]),
      );
    });
  });
});
