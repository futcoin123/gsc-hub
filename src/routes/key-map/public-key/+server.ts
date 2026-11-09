import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { keyMapPublicInfo } from '$lib/server/key-map';

// Открытый ключ хаба для scripts/key-map.mjs: им шифруется «Карта ключей FUT»
// перед тем, как лечь в открытый репозиторий. Сам ключ не секрет; отдаём ещё
// отпечаток карты, которую хаб уже взял, и число сайтов — без их имён.
export const GET: RequestHandler = () => {
  const i = keyMapPublicInfo(db());
  return json(i, { headers: { 'cache-control': 'no-store' } });
};
