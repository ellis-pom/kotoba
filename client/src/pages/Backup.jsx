import { useState } from 'react';
import { api } from '../api';

export default function Backup() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState(null);

  const handleExport = async () => {
    setExporting(true);
    setExportError('');
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kotoba-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.importData(parsed);
      setImportResult(res);
    } catch (e) {
      setImportError(e.message.includes('JSON') ? 'That file doesn\'t look like valid JSON.' : e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Backup &amp; Restore</h1>
      <p className="page-subtitle">Your data lives in a local file, not the cloud — download a copy regularly, especially before switching computers or hosting.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Download everything</h3>
        <p style={{ color: 'var(--paper-dim)' }}>
          Every lesson's vocabulary, kanji, grammar points, culture notes, your spaced-repetition
          progress on each card, verb/adjective classifications, and quiz history — as one JSON file.
        </p>
        <button className="btn" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Preparing…' : '⬇ Download my data'}
        </button>
        {exportError && <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{exportError}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Restore from a backup</h3>
        <p style={{ color: 'var(--paper-dim)' }}>
          Re-importing a lesson number replaces its current content — same behavior as re-pasting
          a lesson. Your review progress and classifications are restored too, not just the content.
        </p>
        <p style={{ color: 'var(--paper-dim)', fontSize: '0.85rem' }}>
          Note: day-by-day activity history on the Stats page (streaks, the 30-day chart) isn't
          part of the backup and won't carry over — only your current review-scheduling state does.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="application/json" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button className="btn btn-secondary" onClick={handleImport} disabled={!file || importing}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
        {importError && <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{importError}</div>}
        {importResult && (
          <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--success)', fontSize: '0.9rem' }}>
            Imported {importResult.lessonsImported} lesson(s), {importResult.itemsImported} item(s) total.
          </p>
        )}
      </div>
    </div>
  );
}
