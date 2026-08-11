import { useEffect, useState } from 'react';
import { api } from '../api';

const MASTERY_LABELS = { new: 'New', learning: 'Learning', young: 'Young', mature: 'Mature' };
const MASTERY_COLORS = { new: 'var(--border)', learning: 'var(--hanko-dim)', young: 'var(--indigo-dim)', mature: 'var(--success)' };

function ActivityChart({ data }) {
  if (!data.length) return null;
  const width = 720;
  const height = 140;
  const padding = 20;
  const barGap = 2;
  const barWidth = (width - padding * 2) / data.length - barGap;
  const maxTotal = Math.max(1, ...data.map((d) => d.total));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Reviews per day for the last 30 days">
      {data.map((d, i) => {
        const x = padding + i * (barWidth + barGap);
        const totalH = (d.total / maxTotal) * (height - padding * 2);
        const correctH = d.total ? (d.correct / d.total) * totalH : 0;
        const y = height - padding - totalH;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barWidth} height={totalH} fill="var(--hanko-dim)" opacity={d.total ? 1 : 0.15} rx="1.5" />
            <rect x={x} y={y + (totalH - correctH)} width={barWidth} height={correctH} fill="var(--indigo)" rx="1.5" />
          </g>
        );
      })}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border)" strokeWidth="1" />
    </svg>
  );
}

export default function Stats() {
  const [overview, setOverview] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getStatsOverview(), api.getStatsLessons(), api.getStatsActivity(30)])
      .then(([o, l, a]) => { setOverview(o); setLessons(l); setActivity(a); })
      .catch((e) => setError(e.message));
  }, []);

  const masteryTotal = overview ? Object.values(overview.mastery).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <h1 className="page-title">Progress</h1>
      <p className="page-subtitle">How your review deck is doing, lesson by lesson.</p>

      {error && <div className="error-banner">{error}</div>}
      {!overview && !error && <p style={{ color: 'var(--paper-dim)' }}>Loading…</p>}

      {overview && (
        <>
          <div className="stat-grid">
            <div className="stat-box"><div className="value">{overview.streakDays}</div><div className="label">Day streak</div></div>
            <div className="stat-box"><div className="value">{overview.accuracy ?? '–'}{overview.accuracy !== null ? '%' : ''}</div><div className="label">Overall accuracy</div></div>
            <div className="stat-box"><div className="value">{overview.totalReviews}</div><div className="label">Total reviews</div></div>
            <div className="stat-box"><div className="value">{overview.dueNow}</div><div className="label">Due right now</div></div>
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginTop: 0 }}>Card mastery</h3>
            {masteryTotal === 0 ? (
              <p style={{ color: 'var(--paper-dim)' }}>No cards yet — add a lesson to get started.</p>
            ) : (
              <>
                <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
                  {Object.entries(overview.mastery).map(([key, count]) => (
                    count > 0 && (
                      <div key={key} style={{ width: `${(count / masteryTotal) * 100}%`, background: MASTERY_COLORS[key] }} title={`${MASTERY_LABELS[key]}: ${count}`} />
                    )
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--paper-dim)' }}>
                  {Object.entries(overview.mastery).map(([key, count]) => (
                    <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: MASTERY_COLORS[key], display: 'inline-block' }} />
                      {MASTERY_LABELS[key]} ({count})
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginTop: 0 }}>Last 30 days</h3>
            <ActivityChart data={activity} />
            <div style={{ display: 'flex', gap: 20, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--paper-dim)', marginTop: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, background: 'var(--indigo)', display: 'inline-block', borderRadius: 2 }} />Correct</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, background: 'var(--hanko-dim)', display: 'inline-block', borderRadius: 2 }} />Missed</span>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Per-lesson progress</h3>
            {lessons.length === 0 ? (
              <p style={{ color: 'var(--paper-dim)' }}>No lessons yet.</p>
            ) : (
              <table>
                <thead><tr><th>Lesson</th><th>Cards</th><th>Started</th><th>Mastered</th></tr></thead>
                <tbody>
                  {lessons.map((l) => (
                    <tr key={l.number}>
                      <td>{l.number}{l.title ? ` — ${l.title}` : ''}</td>
                      <td className="mono">{l.card_count}</td>
                      <td className="mono">{l.started_count || 0}/{l.card_count}</td>
                      <td className="mono">{l.mastered_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
