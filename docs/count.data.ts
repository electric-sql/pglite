import { fetchStarCount } from './components/starCount.ts'

export default {
  async load() {
    return await fetchStarCount()
  },
}
