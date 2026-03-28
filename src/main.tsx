import { createRoot } from "react-dom/client";
import "./styles.css";
import { scan } from "react-scan";
import App from "./App.tsx";
import { ToastProvider } from "./features/layout/contexts/toast-context.tsx";
import { initializeAppBootstrap } from "./lib/app-bootstrap";

scan({
  enabled: import.meta.env.VITE_REACT_SCAN === "true",
});

void initializeAppBootstrap();

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
