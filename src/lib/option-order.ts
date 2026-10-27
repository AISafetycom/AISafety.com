/**
 * A multi-select cell's values in the order of the field's options, so every
 * card lists them the same way ("nonprofits, universities" on each card, never
 * "universities, nonprofits" on one). Airtable returns a cell's values in the
 * order they were ticked. Values the list doesn't know keep their own order,
 * after the known ones.
 */
export function inOptionOrder(
  values: string[],
  options: readonly string[]
): string[] {
  const rank = (value: string) => {
    const i = options.indexOf(value)
    return i === -1 ? options.length : i
  }
  return [...values].sort((a, b) => rank(a) - rank(b))
}
