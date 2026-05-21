import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import * as fs from 'fs/promises'
import { resolve } from 'path'

describe('full icu tests', () => {
  it('load icu', async () => {
    const pg_defIcu = await PGlite.create()

    const defLocales = await pg_defIcu.exec(`
SELECT n.nspname AS schema, c.collname AS name, c.collcollate AS locale,
  c.collctype AS ctype, c.collprovider AS provider, c.collversion
FROM pg_collation c
JOIN pg_namespace n ON c.collnamespace = n.oid
ORDER BY schema, name;
`)

    expect(defLocales[0].rows.length).toBeGreaterThanOrEqual(10)

    const icuDataDir = await fs.readFile(
      resolve(import.meta.dirname, '../dist/icu.76.tgz'),
    )
    const pg_fullIcu = await PGlite.create({
      icuDataDir: new Blob([new Uint8Array(icuDataDir)]),
    })

    const allLocales = await pg_fullIcu.exec(`
SELECT n.nspname AS schema, c.collname AS name, c.collcollate AS locale,
  c.collctype AS ctype, c.collprovider AS provider, c.collversion
FROM pg_collation c
JOIN pg_namespace n ON c.collnamespace = n.oid
ORDER BY schema, name;
        `)

    expect(allLocales[0].rows.length).toBeGreaterThanOrEqual(879)
    expect(defLocales[0].rows.length).toBeLessThan(allLocales[0].rows.length)
  })

  it.skip('use locale-provider icu with german locale', async () => {
    const icuDataDir = await fs.readFile(
      resolve(import.meta.dirname, '../dist/icu.76.tgz'),
    )
    const _pg = await PGlite.create({
      icuDataDir: new Blob([new Uint8Array(icuDataDir)]),
      initDbStartParams: ['--locale-provider=icu', '--icu-locale=de'],
    })
  })
})

describe('icu functionality', () => {
  let pg: PGlite

  beforeAll(async () => {
    const icuData = await fs.readFile(
      resolve(import.meta.dirname, '../dist/icu.76.tgz'),
    )
    pg = await PGlite.create({
      icuDataDir: new Blob([new Uint8Array(icuData)]),
    })

    await pg.exec(`
      CREATE TABLE collate_data (a int, b text);
      INSERT INTO collate_data VALUES (1, 'abc'), (2, 'äbc'), (3, 'bbc'), (4, 'ABC');
    `)
  })

  afterAll(async () => {
    await pg?.close()
  })

  it('icu_unicode_version() returns a value', async () => {
    const res = await pg.query<{ icu_unicode_version: string }>(
      `SELECT icu_unicode_version() AS icu_unicode_version`,
    )
    expect(res.rows[0].icu_unicode_version).toMatch(/^\d+/)
  })

  describe('locale-aware sorting', () => {
    it('English collation sorts äbc near abc', async () => {
      const res = await pg.query<{ b: string }>(
        `SELECT b FROM collate_data ORDER BY b COLLATE "en-x-icu"`,
      )
      const values = res.rows.map((r) => r.b)
      expect(values.indexOf('äbc')).toBeLessThan(values.indexOf('bbc'))
    })

    it('Swedish collation sorts ä after z', async () => {
      const res = await pg.query<{ b: string }>(
        `SELECT b FROM collate_data ORDER BY b COLLATE "sv-x-icu"`,
      )
      const values = res.rows.map((r) => r.b)
      expect(values.indexOf('äbc')).toBe(values.length - 1)
    })

    it('C collation sorts by codepoint (uppercase before lowercase)', async () => {
      const res = await pg.query<{ b: string }>(
        `SELECT b FROM collate_data ORDER BY b COLLATE "C"`,
      )
      const values = res.rows.map((r) => r.b)
      expect(values[0]).toBe('ABC')
    })

    it('en-x-icu and sv-x-icu produce different orderings', async () => {
      const en = await pg.query<{ b: string }>(
        `SELECT b FROM collate_data ORDER BY b COLLATE "en-x-icu"`,
      )
      const sv = await pg.query<{ b: string }>(
        `SELECT b FROM collate_data ORDER BY b COLLATE "sv-x-icu"`,
      )
      expect(en.rows.map((r) => r.b)).not.toEqual(sv.rows.map((r) => r.b))
    })

    it('constant expression comparison differs by locale', async () => {
      const res = await pg.query<{ en: boolean; sv: boolean }>(`
        SELECT
          'bbc' COLLATE "en-x-icu" > 'äbc' COLLATE "en-x-icu" AS en,
          'bbc' COLLATE "sv-x-icu" > 'äbc' COLLATE "sv-x-icu" AS sv
      `)
      expect(res.rows[0].en).toBe(true)
      expect(res.rows[0].sv).toBe(false)
    })
  })

  describe('upper/lower case conversion', () => {
    it('basic upper/lower/initcap with ICU', async () => {
      const res = await pg.query<{
        lo: string
        up: string
        ic: string
      }>(`
        SELECT
          lower('HIJ' COLLATE "en-x-icu") AS lo,
          upper('hij' COLLATE "en-x-icu") AS up,
          initcap('hello world' COLLATE "en-x-icu") AS ic
      `)
      expect(res.rows[0].lo).toBe('hij')
      expect(res.rows[0].up).toBe('HIJ')
      expect(res.rows[0].ic).toBe('Hello World')
    })

    it('Turkish dotless-i: lower(I) produces ı', async () => {
      const res = await pg.query<{ en: string; tr: string }>(`
        SELECT
          lower('I' COLLATE "en-x-icu") AS en,
          lower('I' COLLATE "tr-x-icu") AS tr
      `)
      expect(res.rows[0].en).toBe('i')
      expect(res.rows[0].tr).toBe('\u0131')
    })

    it('Turkish upper(i) produces İ', async () => {
      const res = await pg.query<{ en: string; tr: string }>(`
        SELECT
          upper('i' COLLATE "en-x-icu") AS en,
          upper('i' COLLATE "tr-x-icu") AS tr
      `)
      expect(res.rows[0].en).toBe('I')
      expect(res.rows[0].tr).toBe('\u0130')
    })
  })

  describe('ILIKE with locale awareness', () => {
    it('English ILIKE matches KI in Türkiye', async () => {
      const res = await pg.query<{ m: boolean }>(
        `SELECT 'Türkiye' COLLATE "en-x-icu" ILIKE '%KI%' AS m`,
      )
      expect(res.rows[0].m).toBe(true)
    })

    it('Turkish ILIKE does not match KI in Türkiye', async () => {
      const res = await pg.query<{ m: boolean }>(
        `SELECT 'Türkiye' COLLATE "tr-x-icu" ILIKE '%KI%' AS m`,
      )
      expect(res.rows[0].m).toBe(false)
    })

    it('Turkish dotless-i ILIKE behavior', async () => {
      const res = await pg.query<{ en: boolean; tr: boolean }>(`
        SELECT
          'bıt' ILIKE 'BIT' COLLATE "en-x-icu" AS en,
          'bıt' ILIKE 'BIT' COLLATE "tr-x-icu" AS tr
      `)
      expect(res.rows[0].en).toBe(false)
      expect(res.rows[0].tr).toBe(true)
    })
  })

  describe('custom ICU collation attributes', () => {
    beforeAll(async () => {
      await pg.exec(`
        SET client_min_messages = WARNING;
        CREATE COLLATION IF NOT EXISTS testcoll_ignore_accents
          (provider = icu, locale = '@colStrength=primary;colCaseLevel=yes');
        CREATE COLLATION IF NOT EXISTS testcoll_backwards
          (provider = icu, locale = '@colBackwards=yes');
        CREATE COLLATION IF NOT EXISTS testcoll_lower_first
          (provider = icu, locale = '@colCaseFirst=lower');
        CREATE COLLATION IF NOT EXISTS testcoll_upper_first
          (provider = icu, locale = '@colCaseFirst=upper');
        CREATE COLLATION IF NOT EXISTS testcoll_shifted
          (provider = icu, locale = '@colAlternate=shifted');
        CREATE COLLATION IF NOT EXISTS testcoll_numeric
          (provider = icu, locale = '@colNumeric=yes');
        RESET client_min_messages;
      `)
    })

    it('ignore accents: aaá treated equal to AAA at primary level', async () => {
      const res = await pg.query<{ und: boolean; ign: boolean }>(`
        SELECT
          'aaá' > 'AAA' COLLATE "und-x-icu" AS und,
          'aaá' < 'AAA' COLLATE testcoll_ignore_accents AS ign
      `)
      expect(res.rows[0].und).toBe(true)
      expect(res.rows[0].ign).toBe(true)
    })

    it('backwards accents: coté/côte ordering flips', async () => {
      const res = await pg.query<{ und: boolean; bw: boolean }>(`
        SELECT
          'coté' < 'côte' COLLATE "und-x-icu" AS und,
          'coté' > 'côte' COLLATE testcoll_backwards AS bw
      `)
      expect(res.rows[0].und).toBe(true)
      expect(res.rows[0].bw).toBe(true)
    })

    it('case first: lower vs upper ordering', async () => {
      const res = await pg.query<{ lo: boolean; up: boolean }>(`
        SELECT
          'aaa' < 'AAA' COLLATE testcoll_lower_first AS lo,
          'aaa' > 'AAA' COLLATE testcoll_upper_first AS up
      `)
      expect(res.rows[0].lo).toBe(true)
      expect(res.rows[0].up).toBe(true)
    })

    it('shifted: punctuation ignored in comparison', async () => {
      const res = await pg.query<{ und: boolean; shifted: boolean }>(`
        SELECT
          'de-luge' < 'deanza' COLLATE "und-x-icu" AS und,
          'de-luge' > 'deanza' COLLATE testcoll_shifted AS shifted
      `)
      expect(res.rows[0].und).toBe(true)
      expect(res.rows[0].shifted).toBe(true)
    })

    it('numeric collation: A-21 sorts before A-123', async () => {
      const res = await pg.query<{ und: boolean; num: boolean }>(`
        SELECT
          'A-21' > 'A-123' COLLATE "und-x-icu" AS und,
          'A-21' < 'A-123' COLLATE testcoll_numeric AS num
      `)
      expect(res.rows[0].und).toBe(true)
      expect(res.rows[0].num).toBe(true)
    })
  })

  describe('custom collation rules', () => {
    it('custom rule &a < g reorders g after a', async () => {
      await pg.exec(`
        CREATE COLLATION IF NOT EXISTS testcoll_rules1
          (provider = icu, locale = '', rules = '&a < g');
        CREATE TABLE IF NOT EXISTS test_rules (a text);
        DELETE FROM test_rules;
        INSERT INTO test_rules VALUES
          ('Abernathy'), ('apple'), ('bird'), ('Boston'), ('Graham'), ('green');
      `)

      const enOrder = await pg.query<{ a: string }>(
        `SELECT a FROM test_rules ORDER BY a COLLATE "en-x-icu"`,
      )
      const customOrder = await pg.query<{ a: string }>(
        `SELECT a FROM test_rules ORDER BY a COLLATE testcoll_rules1`,
      )

      const enValues = enOrder.rows.map((r) => r.a)
      const customValues = customOrder.rows.map((r) => r.a)

      expect(enValues).not.toEqual(customValues)
      expect(customValues.indexOf('green')).toBeLessThan(
        customValues.indexOf('bird'),
      )
    })
  })

  describe('nondeterministic collations', () => {
    beforeAll(async () => {
      await pg.exec(`
        CREATE COLLATION IF NOT EXISTS ctest_det
          (provider = icu, locale = '', deterministic = true);
        CREATE COLLATION IF NOT EXISTS ctest_nondet
          (provider = icu, locale = '', deterministic = false);
        CREATE COLLATION IF NOT EXISTS case_insensitive
          (provider = icu, locale = '@colStrength=secondary', deterministic = false);
      `)
    })

    it('case-insensitive: abc = ABC', async () => {
      const res = await pg.query<{ eq: boolean }>(
        `SELECT 'abc' COLLATE case_insensitive = 'ABC' COLLATE case_insensitive AS eq`,
      )
      expect(res.rows[0].eq).toBe(true)
    })

    it('case-sensitive: abc != ABC', async () => {
      const res = await pg.query<{ le: boolean; ge: boolean }>(`
        SELECT
          'abc' <= 'ABC' COLLATE ctest_det AS le,
          'abc' >= 'ABC' COLLATE ctest_det AS ge
      `)
      const { le, ge } = res.rows[0]
      // In deterministic collation, abc and ABC are not equal (one of le/ge is false)
      expect(le && ge).toBe(false)
    })

    it('Unicode normalization: NFC = NFD under nondeterministic collation', async () => {
      await pg.exec(`
        CREATE TABLE IF NOT EXISTS test_norm (a int, b text);
        DELETE FROM test_norm;
        INSERT INTO test_norm VALUES (1, U&'\\00E4bc');
        INSERT INTO test_norm VALUES (2, U&'\\0061\\0308bc');
      `)

      const det = await pg.query<{ a: number }>(
        `SELECT * FROM test_norm WHERE b = 'äbc' COLLATE ctest_det`,
      )
      const nondet = await pg.query<{ a: number }>(
        `SELECT * FROM test_norm WHERE b = 'äbc' COLLATE ctest_nondet`,
      )

      expect(det.rows.length).toBe(1)
      expect(nondet.rows.length).toBe(2)
    })

    it('Greek sigma: ὀδυσσεύς = ὈΔΥΣΣΕΎΣ case-insensitively', async () => {
      const res = await pg.query<{ cs: boolean; ci: boolean }>(`
        SELECT
          'ὀδυσσεύς' = 'ὈΔΥΣΣΕΎΣ' COLLATE ctest_det AS cs,
          'ὀδυσσεύς' = 'ὈΔΥΣΣΕΎΣ' COLLATE case_insensitive AS ci
      `)
      expect(res.rows[0].cs).toBe(false)
      expect(res.rows[0].ci).toBe(true)
    })
  })

  describe('German phonebook collation', () => {
    it('Götz sorts differently in standard vs phonebook order', async () => {
      await pg.exec(`
        CREATE COLLATION IF NOT EXISTS testcoll_de_phonebook
          (provider = icu, locale = 'de@collation=phonebook');
      `)

      const res = await pg.query<{ standard: boolean; phonebook: boolean }>(`
        SELECT
          'Goldmann' < 'Götz' COLLATE "de-x-icu" AS standard,
          'Goldmann' > 'Götz' COLLATE testcoll_de_phonebook AS phonebook
      `)
      expect(res.rows[0].standard).toBe(true)
      expect(res.rows[0].phonebook).toBe(true)
    })
  })
})
