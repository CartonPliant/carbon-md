const LOCALE_COOKIE = 'cm_docs_locale'
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|googlebot|bingbot|gptbot|claudebot|perplexity|anthropic|bytespider/i

function readCookie(header, name) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
function prefersFrench(al) {
  if (!al) return false
  return al.toLowerCase().split(',').some((p) => {
    const t = p.trim().split(';')[0]
    return t === 'fr' || t.startsWith('fr-')
  })
}
function cookie(loc) {
  return `${LOCALE_COOKIE}=${loc}; Path=/; Max-Age=31536000; SameSite=Lax`
}
function negotiated(req) {
  const c = readCookie(req.headers.get('cookie'), LOCALE_COOKIE)
  if (c === 'fr' || c === 'en') return c
  const country = (req.headers.get('cf-ipcountry') || '').toUpperCase()
  const al = req.headers.get('accept-language')
  if (prefersFrench(al)) return 'fr'
  if (country === 'FR' || country === 'BE' || country === 'LU') return 'fr'
  if (country === 'CH' && prefersFrench(al)) return 'fr'
  return 'en'
}

export async function onRequest(context) {
  const { request, next } = context
  const url = new URL(request.url)
  const { pathname } = url
  // API, well-known and the agent contract are language-neutral: no locale cookies, no redirects
  if (pathname.startsWith('/v1/') || pathname.startsWith('/.well-known/')) return next()
  if (pathname === '/agent' || pathname === '/agent/') return next()
  if (/\.[a-zA-Z0-9]+$/.test(pathname) || pathname.startsWith('/cdn-cgi/')) return next()

  const isFr = pathname === '/fr' || pathname.startsWith('/fr/')
  const isBot = BOT_RE.test(request.headers.get('user-agent') || '')

  if (pathname === '/fr') {
    url.pathname = '/fr/'
    return new Response(null, { status: 308, headers: { Location: url.toString(), 'Set-Cookie': cookie('fr') } })
  }
  if (isFr) {
    const res = await next()
    const out = new Response(res.body, res)
    out.headers.append('Set-Cookie', cookie('fr'))
    out.headers.set('Content-Language', 'fr')
    return out
  }
  if (isBot) {
    const res = await next()
    const out = new Response(res.body, res)
    out.headers.set('Content-Language', 'en')
    return out
  }
  if (negotiated(request) === 'fr' && (pathname === '/' || pathname === '')) {
    url.pathname = '/fr/'
    return new Response(null, {
      status: 302,
      headers: { Location: url.toString(), 'Set-Cookie': cookie('fr'), Vary: 'Accept-Language, Cookie' },
    })
  }
  const res = await next()
  const out = new Response(res.body, res)
  out.headers.append('Set-Cookie', cookie('en'))
  out.headers.set('Content-Language', 'en')
  out.headers.append('Vary', 'Accept-Language, Cookie')
  return out
}
