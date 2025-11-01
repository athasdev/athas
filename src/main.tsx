import { createRoot } from "react-dom/client";
import "./styles.css";
import { scan } from "react-scan";
import App from "./App.tsx";
import { ToastProvider } from "./features/layout/contexts/toast-context.tsx";

scan({
  enabled: import.meta.env.VITE_REACT_SCAN === "true",
});

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
