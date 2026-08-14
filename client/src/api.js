const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // send the session cookie — needed for both same-origin prod and the Vite dev proxy
    ...options,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // Session expired mid-use (or was never valid) — reload so App.jsx's auth check
    // runs again and shows the login screen, instead of every page silently failing.
    window.location.reload();
    return new Promise(() => {}); // never resolves; the reload is already underway
  }
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  register: (username, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  getLessons: () => request('/lessons'),
  getLesson: (number) => request(`/lessons/${number}`),
  saveLesson: (lesson) => request('/lessons', { method: 'POST', body: JSON.stringify(lesson) }),
  importLessonFromUrl: (url) => request('/lessons/import-url', { method: 'POST', body: JSON.stringify({ url }) }),
  importLessonFromText: (text) => request('/lessons/import-text', { method: 'POST', body: JSON.stringify({ text }) }),
  deleteLesson: (number) => request(`/lessons/${number}`, { method: 'DELETE' }),

  getDueCards: (params) => request(`/review/due?${new URLSearchParams(params)}`),
  getReviewStats: (params) => request(`/review/stats?${new URLSearchParams(params)}`),
  answerCard: (id, quality) => request(`/review/${id}/answer`, { method: 'POST', body: JSON.stringify({ quality }) }),

  generateQuiz: (params) => request(`/quiz/generate?${new URLSearchParams(params)}`),
  submitQuiz: (payload) => request('/quiz/submit', { method: 'POST', body: JSON.stringify(payload) }),
  getQuizHistory: () => request('/quiz/history'),

  practiceSentence: (lessonNumber) => request('/ai/practice-sentence', { method: 'POST', body: JSON.stringify({ lessonNumber }) }),
  translateQuestion: (minLesson, maxLesson) => request('/ai/translate-question', { method: 'POST', body: JSON.stringify({ minLesson, maxLesson }) }),
  explainGrammar: (grammarPointId) => request('/ai/explain-grammar', { method: 'POST', body: JSON.stringify({ grammarPointId }) }),

  extractLessonFromPdf: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/ai/extract-lesson`, { method: 'POST', body: formData, credentials: 'include' });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await res.json() : null;
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
  },

  getStatsOverview: () => request('/stats/overview'),
  getStatsLessons: () => request('/stats/lessons'),
  getStatsActivity: (days = 30) => request(`/stats/activity?days=${days}`),

  classifyVerbs: () => request('/verbs/classify', { method: 'POST' }),
  getVerbTable: (params) => request(`/verbs/table?${new URLSearchParams(params)}`),

  exportData: () => request('/data/export'),
  importData: (data) => request('/data/import', { method: 'POST', body: JSON.stringify(data) }),
};

// Parses "JP: ...\nREADING: ...\nEN: ..." style responses from the AI routes into an object.
export function parseAiSentence(raw) {
  const get = (label) => {
    const m = raw.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  return { japanese: get('JP'), reading: get('READING'), english: get('EN') };
}
