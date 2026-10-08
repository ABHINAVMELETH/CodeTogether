const Y = require("yjs");

const documents = new Map();

const initializedDocuments = new Set();

/*
 * =========================================================
 * GET DOCUMENT
 * =========================================================
 */

function hasDocument(fileId) {
  return documents.has(fileId);
}

/*
 * =========================================================
 * GET DOCUMENT
 * =========================================================
 */

function getDocument(fileId) {
  if (!documents.has(fileId)) {
    const doc = new Y.Doc();

    documents.set(fileId, doc);
  }

  return documents.get(fileId);
}

/*
 * =========================================================
 * INITIALIZE FROM YJS STATE
 * =========================================================
 *
 * If a Yjs state exists in PostgreSQL, restore it.
 *
 * Otherwise initialize from normal file content.
 */

function initializeDocument(
  fileId,
  content = "",
  yjsState = null
) {
  const doc = getDocument(fileId);

  /*
   * Don't initialize the same document twice.
   */
  if (initializedDocuments.has(fileId)) {
    return doc;
  }

  /*
   * -------------------------------------------------------
   * Restore existing Yjs CRDT state
   * -------------------------------------------------------
   */

  if (yjsState) {
    try {
      const update =
        new Uint8Array(yjsState);

      Y.applyUpdate(
        doc,
        update
      );

      initializedDocuments.add(
        fileId
      );

      console.log(
        `Yjs state restored for file ${fileId}`
      );

      return doc;
    } catch (error) {
      console.error(
        `Failed to restore Yjs state for ${fileId}:`,
        error
      );
    }
  }

  /*
   * -------------------------------------------------------
   * No Yjs state exists.
   *
   * Initialize from PostgreSQL content.
   * -------------------------------------------------------
   */

  const text =
    doc.getText("content");

  if (content) {
    doc.transact(() => {
      text.insert(
        0,
        content
      );
    });
  }

  initializedDocuments.add(
    fileId
  );

  console.log(
    `Yjs document initialized from file content: ${fileId}`
  );

  return doc;
}

/*
 * =========================================================
 * GET CURRENT CODE
 * =========================================================
 */

function getDocumentText(fileId) {
  const doc =
    getDocument(fileId);

  return doc
    .getText("content")
    .toString();
}

/*
 * =========================================================
 * GET YJS STATE
 * =========================================================
 *
 * This returns the complete CRDT state.
 */

function getDocumentState(fileId) {
  const doc =
    getDocument(fileId);

  return Y.encodeStateAsUpdate(
    doc
  );
}

/*
 * =========================================================
 * DELETE DOCUMENT
 * =========================================================
 */

function deleteDocument(fileId) {
  const doc =
    documents.get(fileId);

  if (doc) {
    doc.destroy();
  }

  documents.delete(fileId);

  initializedDocuments.delete(
    fileId
  );
}

module.exports = {
  getDocument,
  initializeDocument,
  getDocumentText,
  getDocumentState,
  hasDocument,
  deleteDocument,
};