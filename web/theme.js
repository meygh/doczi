// Apply the saved theme before the page paints (kept separate so the page needs no inline script).
try {
  const t = localStorage.getItem("progress-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch { /* storage blocked: follow the system */ }
