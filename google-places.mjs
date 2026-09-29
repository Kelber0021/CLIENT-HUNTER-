// Google Places results are deliberately ephemeral. Do not cache or persist them.
const endpoint = 'https://places.googleapis.com/v1/places:searchNearby'
const types = {
  all: null,
  restaurant: ['restaurant', 'bar', 'fast_food_restaurant'],
  cafe: ['cafe', 'bakery'],
  shop: ['store', 'shopping_mall'],
  beauty: ['beauty_salon', 'hair_salon', 'nail_salon'],
  health: ['medical_clinic', 'dentist', 'pharmacy'],
  fitness: ['gym', 'fitness_center', 'sports_complex'],
  hotel: ['hotel', 'guest_house', 'hostel'],
  office: ['consultant', 'lawyer', 'real_estate_agency', 'insurance_agency'],
}
const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.googleMapsUri'
const buckets = new Map()
let globalBucket = { minute: 0, count: 0, day: 0, dailyCount: 0 }

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function limited(req) {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const day = Math.floor(now / 86_400_000)
  if (globalBucket.minute !== minute) { globalBucket.minute = minute; globalBucket.count = 0 }
  if (globalBucket.day !== day) { globalBucket.day = day; globalBucket.dailyCount = 0 }
  // Render forwards the visitor's address. Ignore any later, user-supplied hops.
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 64)
  const current = buckets.get(ip)
  const bucket = current?.minute === minute ? current : { minute, count: 0 }
  buckets.set(ip, bucket)
  if (buckets.size > 2000) for (const [key, value] of buckets) if (value.minute < minute - 2) buckets.delete(key)
  if (bucket.count >= 4 || globalBucket.count >= 30 || globalBucket.dailyCount >= 300) return true
  bucket.count++
  globalBucket.count++
  globalBucket.dailyCount++
  return false
}

export function googlePlacesStatus(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' })
  json(res, 200, { available: Boolean(process.env.GOOGLE_MAPS_API_KEY), source: 'Google Places', maxResultsPerSearch: 20 })
}

export async function handleGooglePlaces(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' })
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return json(res, 503, { available: false, error: 'Google Places não configurado.', source: 'Google Places' })
  const url = new URL(req.url || '', 'http://localhost')
  const latInput = url.searchParams.get('lat')
  const lngInput = url.searchParams.get('lng') ?? url.searchParams.get('lon')
  const radiusInput = url.searchParams.get('radius')
  const lat = Number(latInput)
  const lng = Number(lngInput)
  const radius = Number(radiusInput)
  const segment = url.searchParams.get('segment') || url.searchParams.get('category') || 'all'
  if (!latInput || !lngInput || !radiusInput || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isFinite(radius) || radius < 100 || radius > 15000 || !Object.hasOwn(types, segment)) {
    return json(res, 400, { error: 'Informe latitude, longitude, raio em metros (100 a 15000) e segmento válido.' })
  }
  if (limited(req)) return json(res, 429, { error: 'Limite de consultas ao Google atingido. Tente mais tarde.' })
  const payload = {
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    languageCode: 'pt-BR',
    regionCode: 'BR',
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    ...(types[segment] ? { includedTypes: types[segment] } : {}),
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) {
      // Never return Google's body because it might include account information.
      console.error('Google Places failed:', response.status)
      return json(res, response.status === 429 ? 429 : 502, { error: 'Não foi possível consultar o Google Places agora.' })
    }
    const result = await response.json()
    const places = (Array.isArray(result.places) ? result.places : []).filter(p => p.id && p.displayName?.text).map(p => ({
      id: p.id,
      name: p.displayName.text,
      category: p.primaryTypeDisplayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location?.latitude ?? null,
      lon: p.location?.longitude ?? null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      googleMapsUrl: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.id)}`,
      source: 'Google Places',
    }))
    json(res, 200, { available: true, source: 'Google Places', places, coverage: { partial: true, maxResults: 20, reason: 'O Google retorna no máximo 20 locais nesta consulta; resultados não representam todos os negócios do raio.' } })
  } catch (error) {
    console.error('Google Places request failed:', error?.name || 'unknown')
    json(res, 502, { error: 'A consulta ao Google Places demorou demais ou falhou.' })
  }
}
