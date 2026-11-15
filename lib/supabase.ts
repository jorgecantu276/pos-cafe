import { createBrowserClient } from '@supabase/ssr'
import { supabasePublicKey } from './supabase-public-config'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = supabasePublicKey()

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
