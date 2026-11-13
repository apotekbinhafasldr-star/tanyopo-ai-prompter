// QA-2: antarmuka kotak masuk tetap (inbox) untuk email nyata. Penyedia kotak masuk permanen BELUM diputuskan,
// jadi tidak ada implementasi dan tidak boleh diasumsikan (bukan Gmail/IMAP/lainnya).

/**
 * @typedef {Object} InboxMessage
 * @property {string} subject
 * @property {string} html
 * @property {Record<string, string>} headers
 */

/**
 * @typedef {Object} WaitOptions
 * @property {string} subjectIncludes
 * @property {number} timeoutMs
 */

/**
 * @typedef {Object} InboxAdapter
 * @property {() => Promise<void>} clear Mengosongkan kotak masuk tetap sebelum tes.
 * @property {(options: WaitOptions) => Promise<InboxMessage>} waitForMessage Menunggu email nyata masuk.
 */

/**
 * @param {string} kind jenis penyedia (belum ada yang dipilih)
 * @returns {InboxAdapter}
 */
export function createInboxAdapter(kind) {
  if (typeof kind !== "string") throw new Error("NOT_IMPLEMENTED: provider not chosen");
  throw new Error("NOT_IMPLEMENTED: provider not chosen");
}
