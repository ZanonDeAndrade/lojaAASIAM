import React from "react";
import ReactDOM from "react-dom/client";
import { lazy, Suspense } from 'react';
import SiteBootstrap from './settings/SiteBootstrap.jsx';
import "./styles.css";

const AdminPage = lazy(() => import('./admin/AdminPage.jsx'));
const isAdmin = /^\/admin\/?$/.test(location.pathname);
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={<p role="status">Carregando…</p>}>
      {isAdmin ? <AdminPage /> : <SiteBootstrap />}
    </Suspense>
  </React.StrictMode>
);
