import { tests } from './base.js'

tests('firefox', 'memfs2opfs://base', 'firefox.memfs2opfs')
tests('firefox', 'memfs2opfs://worker', 'firefox.memfs2opfs.worker')
