import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useHashRoute } from './store';
import { Nav, HomePage, CreatePage, PreviewPage, LibraryPage, ServerTaskSync } from './pages';
import { AuthGate } from './auth';
import './themes.css';

function App() {
  const route = useHashRoute();

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input,textarea")) return;
      if (e.key === "1") route.navigate("/");
      if (e.key === "2") route.navigate("/create");
      if (e.key === "3") route.navigate("/library");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route.navigate]);

  let Page = HomePage;
  if (route.path === "/create") Page = CreatePage;
  else if (route.path === "/preview") Page = PreviewPage;
  else if (route.path === "/library") Page = LibraryPage;

  return (
    <div className="app">
      <ServerTaskSync />
      <Nav route={route} navigate={route.navigate} />
      <main className="main">
        <Page />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <AuthGate>
    <StoreProvider><App /></StoreProvider>
  </AuthGate>
);
