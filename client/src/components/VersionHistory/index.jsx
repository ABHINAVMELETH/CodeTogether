
import { useCallback, useEffect, useState } from "react";
import "./index.css";

const API_URL = "http://localhost:5000";

export default function VersionHistory({
  fileId,
  socket,
  restoreStatus,
  onClose,
}) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadVersions = useCallback(async () => {
    if (!fileId) return;

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");

      const response = await fetch(
        `${API_URL}/api/files/${fileId}/versions`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Could not load versions"
        );
      }

      setVersions(result.versions || []);
    } catch (err) {
      setError(err.message || "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (restoreStatus?.type === "success") {
      loadVersions();
    } else if (restoreStatus?.type === "error") {
      setError(restoreStatus.message);
    }
  }, [restoreStatus, loadVersions]);

  const restoreVersion = (version) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("You are disconnected. Reconnect and try again.");
      return;
    }

    const confirmed = window.confirm(
      `Restore revision ${version.revision}? ` +
      "This will replace the current editor content for everyone."
    );

    if (!confirmed) return;

    setError("");

    socket.send(
      JSON.stringify({
        type: "restore-version",
        fileId,
        versionId: version.id,
      })
    );
  };

  return (
    <section className="version-history">
      <header className="version-history-header">
        <h3>Version History</h3>

        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      {loading && <p>Loading versions...</p>}

      {error && (
        <p className="version-history-error">{error}</p>
      )}

      {!loading && !error && versions.length === 0 && (
        <p>No saved versions yet. Edit the file and wait a few seconds.</p>
      )}

      <div className="version-history-list">
        {versions.map((version) => (
          <article
            className="version-history-item"
            key={version.id}
          >
            <div>
              <strong>Revision {version.revision}</strong>

              <p>
                {new Date(version.created_at).toLocaleString()}
              </p>
            </div>

            <div className="version-history-actions">
              <button
                type="button"
                onClick={() => setSelectedVersion(version)}
              >
                Preview
              </button>

              <button
                type="button"
                onClick={() => restoreVersion(version)}
              >
                Restore
              </button>
            </div>
          </article>
        ))}
      </div>

      {selectedVersion && (
        <div className="version-preview">
          <h4>Revision {selectedVersion.revision}</h4>

          <pre>
            <code>{selectedVersion.content}</code>
          </pre>

          <button
            type="button"
            onClick={() => setSelectedVersion(null)}
          >
            Close preview
          </button>
        </div>
      )}
    </section>
  );
}