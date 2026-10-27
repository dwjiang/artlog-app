import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DemoPage } from "./demo-page.tsx";

import "./demo-page.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <DemoPage />
  </StrictMode>,
);
