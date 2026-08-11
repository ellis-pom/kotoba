import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Lessons from './pages/Lessons.jsx';
import AddLesson from './pages/AddLesson.jsx';
import LessonDetail from './pages/LessonDetail.jsx';
import Study from './pages/Study.jsx';
import Quiz from './pages/Quiz.jsx';
import TestPage from './pages/TestPage.jsx';
import Stats from './pages/Stats.jsx';
import VerbTable from './pages/VerbTable.jsx';
import Backup from './pages/Backup.jsx';
import Login from './pages/Login.jsx';
import { api } from './api';

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  if (checking) return null; // avoid a login-page flash while the session check is in flight

  if (!user) {
    return <Login onAuthenticated={setUser} />;
  }

  return (
    <div className="app-shell">
      <Sidebar username={user.username} onLogout={() => { api.logout().finally(() => setUser(null)); }} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lessons" element={<Lessons />} />
          <Route path="/lessons/new" element={<AddLesson />} />
          <Route path="/lessons/:number" element={<LessonDetail />} />
          <Route path="/lessons/:number/edit" element={<AddLesson />} />
          <Route path="/study" element={<Study />} />
          <Route path="/quiz" element={<Quiz />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/verbs" element={<VerbTable />} />
          <Route path="/backup" element={<Backup />} />
        </Routes>
      </main>
    </div>
  );
}
