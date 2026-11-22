// Узнать свои адреса так, как их видят сайты на Cloudflare: IPv6 (если есть) и
// IPv4. Панель доступна только по IPv4 — сама она IPv6 не увидит.
export async function myIps(): Promise<string[]> {
  const ask = async (url: string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      return r.ok ? String(((await r.json()) as { ip?: unknown }).ip ?? '') : '';
    } catch {
      return '';
    }
  };
  const [a, b] = await Promise.all([ask('https://api64.ipify.org?format=json'), ask('https://api.ipify.org?format=json')]);
  return [...new Set([a, b].filter(Boolean))];
}

/** Сообщить адреса панели (url — куда POST { ip }). */
export async function reportIps(url: string): Promise<string[]> {
  const out: string[] = [];
  for (const ip of await myIps()) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip }) });
      if (r.ok && ((await r.json()) as { ip?: string | null }).ip) out.push(ip);
    } catch {
      /* не страшно: в следующий раз */
    }
  }
  return out;
}
