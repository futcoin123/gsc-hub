import { building } from '$app/environment';
import { startBacklinkMonitor } from '$lib/server/backlink-monitor';
import { startUptimeMonitor } from '$lib/server/uptime';
import { db } from '$lib/server/db';
import { sequence } from '@sveltejs/kit/hooks';
import { handle as authHandle } from './auth';
import { authGuard } from '$lib/server/guard';
import { attachGscCacheStore } from '$lib/server/gsc-cache';

export const handle = sequence(authGuard, authHandle);

export const init = () => {
  if (!building) {
    // Ответы Google, сохранённые до перезапуска: страницы не ждут Google заново.
    try {
      attachGscCacheStore(db());
    } catch (e) {
      console.error('gsc cache store:', (e as Error).message);
    }
    startBacklinkMonitor();
    startUptimeMonitor(db);
  }
};
