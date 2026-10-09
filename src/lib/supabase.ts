import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from './env';

export const BUCKET = 'nomad-private';

let client: SupabaseClient | null = null;

/** 공개용 Publishable Key만 사용한다. 비밀 키는 이 앱 어디에도 없다. */
export function sb(): SupabaseClient {
  if (!appConfig.ok) throw new Error('설정값이 없습니다.');
  if (!client) {
    client = createClient(appConfig.config.supabaseUrl, appConfig.config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'nomad-atlas-auth',
      },
    });
  }
  return client;
}
