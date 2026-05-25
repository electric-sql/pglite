import { copyFiles, findAndReplaceInDir } from '@electric-sql/pglite-utils/scripts/fileUtils'

async function main() {
  await copyFiles('./release', './dist')
  await findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
  await findAndReplaceInDir('./dist/contrib', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/vector', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_ivm', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pgtap', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_uuidv7', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/age', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_textsearch', /\.\.\/release\//g, 
    '', ['.js', '.cjs'])  
  await findAndReplaceInDir(
    './dist',
    `require("./postgres.js")`,
    `require("./postgres.cjs").default`,
    ['.cjs'],
  )
  await findAndReplaceInDir('./dist/pg_hashids', /\.\.\/release\//g, '', ['.js', '.cjs'])
}

await main()
