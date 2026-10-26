// Entry point of the Faceless Studio office, bundled by office/build.mjs into public/app.js.
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./office.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
