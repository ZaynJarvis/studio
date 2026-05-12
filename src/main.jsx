import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useHashRoute } from './store';
import { Nav, HomePage, CreatePage, PreviewPage, LibraryPage, QueuePage, ServerTaskSync } from './pages';
import './themes.css';

function App() {
  const route = useHashRoute();

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input,textarea")) return;
      if (e.key === "1") route.navigate("/");
      if (e.key === "2") route.navigate("/create");
      if (e.key === "3") route.navigate("/library");
      if (e.key === "4") route.navigate("/queue");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route.navigate]);

  let Page = HomePage;
  if (route.path === "/create") Page = CreatePage;
  else if (route.path === "/preview") Page = PreviewPage;
  else if (route.path === "/library") Page = LibraryPage;
  else if (route.path === "/queue") Page = QueuePage;

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
  <StoreProvider><App /></StoreProvider>
);
