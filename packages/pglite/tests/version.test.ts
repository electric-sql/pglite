import { PGlite } from '../src/pglite';
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';

describe('PGlite version reporting', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await PGlite.create({ dataDir: 'memory://test' });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('should create PGLITE_VERSION file with correct content', async () => {
    const versionFilePath = '/tmp/pglite/base/PGLITE_VERSION';
    const versionFileContent = await fs.readFile(versionFilePath, 'utf8');
    const version = await pg.query<{ version: string }>('SELECT version()');
    const expectedContent = `Created by: ${version.rows[0].version}`;
    expect(versionFileContent).toBe(expectedContent);
  });

  it('should report correct version with SELECT VERSION()', async () => {
    const result = await pg.query<{ version: string }>('SELECT version()');
    expect(result.rows[0].version).toContain('PGlite');
  });
});
