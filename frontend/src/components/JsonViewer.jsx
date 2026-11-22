import { useEffect, useRef, useState } from "react";

export default function JsonViewer({ graph, onExport }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const json = JSON.stringify(graph, null, 2);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false); // clipboard can be blocked; Export JSON still works
    }
  };

  return (
    <section className="panel json-viewer" aria-labelledby="json-title">
      <div className="json-viewer__head">
        <h2 id="json-title">Generated JSON</h2>
        <div className="json-viewer__actions">
          <button type="button" className="btn btn--small" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="btn btn--small" onClick={onExport}>
            Export JSON
          </button>
        </div>
      </div>
      <pre className="json-viewer__code" tabIndex={0}>
        <code>{json}</code>
      </pre>
    </section>
  );
}
