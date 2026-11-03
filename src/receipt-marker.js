export const READ_RECEIPT_MARKER_SOURCE = 'dsh-memory-bridge'
export const MEMORY_MESSAGE_SOURCE_KIND = `plugin:${READ_RECEIPT_MARKER_SOURCE}`

const RECEIPT_ID = 'rr_[0-9a-f]{32}'
const RECEIPT_MARKER_PATTERN = new RegExp(
  `<memory_read_receipt>\\s*(${RECEIPT_ID})\\s*</memory_read_receipt>`,
  'g'
)

export function receiptMarkers(text) {
  const output = []
  const seen = new Set()
  for (const match of String(text ?? '').matchAll(RECEIPT_MARKER_PATTERN)) {
    const receiptId = match[1]
    if (seen.has(receiptId)) continue
    output.push(`<memory_read_receipt>${receiptId}</memory_read_receipt>`)
    seen.add(receiptId)
  }
  return output
}

/** Receipt attribution belongs to the trace, not to the model's prompt. */
export function stripReceiptMarkers(text) {
  return String(text ?? '').replace(RECEIPT_MARKER_PATTERN, '').trim()
}

export function receiptIdFromText(text) {
  return receiptMarkers(text)[0]?.match(new RegExp(RECEIPT_ID))?.[0]
}

export function isReadReceiptId(value) {
  return typeof value === 'string' && new RegExp(`^${RECEIPT_ID}$`).test(value)
}

export function receiptTraceText(message, messageText) {
  const source = message?.source
  const isCurrentSource = source?.kind === MEMORY_MESSAGE_SOURCE_KIND
  const isLegacySource = source?.kind === 'plugin' &&
    source.plugin === READ_RECEIPT_MARKER_SOURCE
  if (!isCurrentSource && !isLegacySource) return ''
  const stored = isReadReceiptId(source.readReceiptId)
    ? `<memory_read_receipt>${source.readReceiptId}</memory_read_receipt>`
    : ''
  return [...new Set([stored, ...receiptMarkers(messageText(message))].filter(Boolean))].join('\n')
}
