import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useHashRoute } from './store';
import { Nav, HomePage, CreatePage, PreviewPage, LibraryPage, CharacterDesignPage, ServerTaskSync, RemoteImageSync } from './pages';
import { AuthGate } from './auth';
import { ZoukStudioChat } from './zouk-embed';
import './themes.css';

function App() {
  const route = useHashRoute();
  const navigate = route.navigate;

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input,textarea")) return;
      if (e.key === "1") navigate("/");
      if (e.key === "2") navigate("/create");
      if (e.key === "3") navigate("/library");
      if (e.key === "4") navigate("/design");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  let Page = HomePage;
  if (route.path === "/create") Page = CreatePage;
  else if (route.path === "/preview") Page = PreviewPage;
  else if (route.path === "/library") Page = LibraryPage;
  else if (route.path === "/design") Page = CharacterDesignPage;

  return (
    <div className="app">
      <ServerTaskSync />
      <RemoteImageSync />
      <Nav route={route} navigate={route.navigate} />
      <main className="main">
        <Page />
      </main>
      <ZoukStudioChat route={route} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <AuthGate>
    <StoreProvider><App /></StoreProvider>
  </AuthGate>
);

export default App;
