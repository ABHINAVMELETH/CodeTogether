const fileRevisions = new Map();

const getRevision = (fileId) => {
  return fileRevisions.get(fileId);
};

const setRevision = (
  fileId,
  revision
) => {
  fileRevisions.set(
    fileId,
    revision
  );
};

const deleteRevision = (fileId) => {
  fileRevisions.delete(fileId);
};

module.exports = {
  getRevision,
  setRevision,
  deleteRevision,
};