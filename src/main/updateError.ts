import { t } from '@shared/i18n'

/** Übersetzt einen Roh-Fehler in eine verständliche Meldung in der aktuellen Sprache (Roh-Text wird kurz angehängt). */
export function describeUpdateError(e: unknown): string {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '').split('\n')[0].trim()
  const short = raw.length > 140 ? raw.slice(0, 140) + '…' : raw
  let nice = t('update.error.default')
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|net::/i.test(raw)) nice = t('update.error.network')
  else if (/404|latest\.yml|Cannot find/i.test(raw)) nice = t('update.error.notFound')
  else if (/403|rate limit/i.test(raw)) nice = t('update.error.rateLimit')
  else if (/sha512|checksum/i.test(raw)) nice = t('update.error.corrupt')
  return short ? `${nice} (${short})` : nice
}
