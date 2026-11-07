let counter = 0

/** Kurze, im Programmlauf eindeutige ID. */
export function uid(): string {
  counter = (counter + 1) % 0xffffff
  return (
    Date.now().toString(36) +
    counter.toString(36) +
    Math.floor(Math.random() * 0xffffff).toString(36)
  )
}
