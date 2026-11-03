/**
 * Read one immutable Session event snapshot across DSH Session API versions.
 *
 * dsh-session 0.2 removed the `session.events` getter in favor of
 * `session.snapshotEvents()`. Older DSH releases expose only `session.events`.
 */
export function sessionEvents(session) {
  if (typeof session?.snapshotEvents === 'function') {
    return session.snapshotEvents()
  }
  return Array.from(session?.events ?? [])
}
