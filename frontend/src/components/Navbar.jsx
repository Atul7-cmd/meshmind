import { useState } from "react";

function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 21 16 10M16 10l7 11M9 21h14" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="16" cy="10" r="3.2" fill="#4c8dff" />
      <circle cx="9" cy="21" r="3.2" fill="#35d0e8" />
      <circle cx="23" cy="21" r="3.2" fill="#35d0e8" />
    </svg>
  );
}

function describeHealth(health) {
  if (!health.checked) return { tone: "pending", text: "Checking backend" };
  if (!health.online) return { tone: "down", text: "Backend offline" };
  if (!health.geminiConfigured) return { tone: "warn", text: "Gemini key missing" };
  return { tone: "up", text: "Backend online" };
}

export default function Navbar({ health }) {
  const [open, setOpen] = useState(false);
  const status = describeHealth(health);
  const close = () => setOpen(false);

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <a className="brand" href="#top" onClick={close}>
          <BrandMark />
          <span>MeshMind AI</span>
        </a>
        <button
          type="button"
          className="navbar__toggle"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Menu"}
        </button>
        <nav id="primary-nav" className={`navbar__links${open ? " is-open" : ""}`}>
          <a href="#workspace" onClick={close}>Workspace</a>
          <a href="#how-it-works" onClick={close}>How it works</a>
          <span className={`status status--${status.tone}`} role="status">
            <span className="status__dot" aria-hidden="true" />
            {status.text}
          </span>
        </nav>
      </div>
    </header>
  );
}
