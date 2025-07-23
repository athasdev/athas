import { createRoot } from "react-dom/client";
import "./styles.css";
import { scan } from "react-scan";
import App from "./App.tsx";
import { ToastProvider } from "./contexts/toast-context.tsx";

// helps track re-renders in development mode
scan({
  enabled: true,
});

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
