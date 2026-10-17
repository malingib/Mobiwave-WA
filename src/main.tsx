import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary, NetworkStatus } from "./ErrorPages";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><NetworkStatus /><App /></AppErrorBoundary>
  </React.StrictMode>,
);
