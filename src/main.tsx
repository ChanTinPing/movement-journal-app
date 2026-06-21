import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const isNativeCapacitor = () => {
  const capacitor = (window as CapacitorWindow).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
};

if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeCapacitor()) {
  let didRefresh = false;
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || didRefresh) {
      return;
    }

    didRefresh = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        registration.update().catch(() => undefined);

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) {
            return;
          }

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((error: unknown) => {
        console.warn("Service worker registration failed", error);
      });
  });
}
