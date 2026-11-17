import { createBrowserClient } from '@supabase/ssr'
import { supabasePublicKey } from './supabase-public-config'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublicKey())
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
