import { pglFileUtils } from '@electric-sql/pglite-utils'

async function main() {
  await pglFileUtils.copyFiles('./release', './dist')
  await pglFileUtils.findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
  await pglFileUtils.findAndReplaceInDir('./dist/contrib', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await pglFileUtils.findAndReplaceInDir('./dist/vector', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await pglFileUtils.findAndReplaceInDir('./dist/pg_ivm', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await pglFileUtils.findAndReplaceInDir('./dist/pgtap', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await pglFileUtils.findAndReplaceInDir('./dist/pg_uuidv7', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await pglFileUtils.findAndReplaceInDir('./dist/age', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await pglFileUtils.findAndReplaceInDir('./dist/pg_textsearch', /\.\.\/release\//g, 
    '', ['.js', '.cjs'])  
  await pglFileUtils.findAndReplaceInDir(
    './dist',
    `require("./postgres.js")`,
    `require("./postgres.cjs").default`,
    ['.cjs'],
  )
  await pglFileUtils.findAndReplaceInDir('./dist/pg_hashids', /\.\.\/release\//g, '', ['.js', '.cjs'])
}

await main()
