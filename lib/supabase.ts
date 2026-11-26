import { createBrowserClient } from '@supabase/ssr'
import { supabasePublicKey } from './supabase-public-config'
import { operationsDemoAuth } from './operations-demo-auth'
import { browserSupabaseUrl, supabaseStorageKey, supabaseCookieOptions } from './supabase-connection'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
function createClient() {
  const origin = typeof window === 'undefined' ? process.env.POS_PUBLIC_ORIGIN : window.location.origin
  return createBrowserClient(browserSupabaseUrl(supabaseUrl, typeof window === 'undefined' ? undefined : origin), supabasePublicKey(), {
    auth: { storageKey: supabaseStorageKey(supabaseUrl) }, cookieOptions: supabaseCookieOptions(supabaseUrl, origin),
    ...operationsDemoAuth(supabaseUrl),
  })
}
type BrowserClient = ReturnType<typeof createClient>
let client: BrowserClient | undefined
const methods = new Map<PropertyKey, unknown>()

// Route modules may be evaluated before the portable runtime script has loaded.
// Keep the SDK singleton uninitialized until the ready gate mounts a consumer.
export const supabase = new Proxy({} as BrowserClient, {
  get(_target, property) {
    client ??= createClient()
    const value = Reflect.get(client, property, client)
    if (typeof value !== 'function') return value
    if (!methods.has(property)) methods.set(property, value.bind(client))
    return methods.get(property)
  },
})
