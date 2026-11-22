import { MAX_DESCRIPTION_CHARS } from "../services/api.js";

export default function InputPanel({ value, onChange, onGenerate, onClear, onExample, loading, validation }) {
  const length = value.length;
  const tooLong = length > MAX_DESCRIPTION_CHARS;

  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !loading) {
      event.preventDefault();
      onGenerate();
    }
  };

  return (
    <section className="panel input-panel" aria-labelledby="input-title">
      <h2 id="input-title">Infrastructure description</h2>
      <label className="sr-only" htmlFor="description">Infrastructure description</label>
      <textarea
        id="description"
        className={`input-panel__text${validation ? " has-error" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Example: The Order Service calls the Payment Service. The Payment Service stores transactions in the Payment Database."
        rows={11}
        aria-invalid={Boolean(validation)}
        aria-describedby="description-help"
        disabled={loading}
      />
      <div className="input-panel__meta" id="description-help">
        <span className={validation ? "text-error" : "text-muted"} role={validation ? "alert" : undefined}>
          {validation || "Ctrl or ⌘ + Enter to generate."}
        </span>
        <span className={tooLong ? "text-error" : "text-muted"}>
          {length}/{MAX_DESCRIPTION_CHARS}
        </span>
      </div>
      <div className="input-panel__actions">
        <button type="button" className="btn btn--primary" onClick={onGenerate} disabled={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? "Generating" : "Generate Graph"}
        </button>
        <button type="button" className="btn" onClick={onExample} disabled={loading}>
          Use example
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClear}>
          Clear
        </button>
      </div>
    </section>
  );
}
