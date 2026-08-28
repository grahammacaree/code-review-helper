import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DesignMode } from "./design/DesignMode";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
// The npm script sets the flag, so a reload that drops the query cannot boot
// the real app — which would then fail against an API design mode never needs.
const design =
  import.meta.env.VITE_DESIGN === "1" ||
  new URLSearchParams(window.location.search).has("design");
createRoot(root).render(
  <StrictMode>{design ? <DesignMode /> : <App />}</StrictMode>,
);
