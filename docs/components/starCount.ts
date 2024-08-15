const FALLBACK_INITIAL_COUNT = 5_000

export async function localStorageCache(
  key: string,
  ttl: number,
  valueCb: () => unknown,
) {
  const now = new Date().getTime()
  const cachedItem = localStorage.getItem(key)

  if (cachedItem) {
    const cachedData = JSON.parse(cachedItem)
    if (now < cachedData.expiry) {
      return cachedData.value
    }
  }

  const value = await valueCb()
  const expiry = now + ttl * 1000
  const dataToCache = {
    value: value,
    expiry: expiry,
  }
  localStorage.setItem(key, JSON.stringify(dataToCache))
  return value
}

export async function starCount(currentCount) {
  const ttl = 3600 // 1 hour
  return localStorageCache('starCount', ttl, async () => {
    return await fetchStarCount(currentCount)
  })
}

export async function fetchStarCount(currentCount) {
  const resp = await fetch('https://api.github.com/repos/electric-sql/pglite')

  if (resp.ok) {
    const data = await resp.json()

    return data.stargazers_count
  }

  return currentCount || FALLBACK_INITIAL_COUNT
}
