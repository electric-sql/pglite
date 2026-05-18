import { fetchNpmJsDownloadCount } from './components/starCount.ts'

export default {
  async load() {
    return await fetchNpmJsDownloadCount()
  },
}
