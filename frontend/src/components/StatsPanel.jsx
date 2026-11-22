export default function StatsPanel({ graph }) {
  const { nodes, edges, summary, analysis } = graph;
  const label = Object.fromEntries(nodes.map((n) => [n.id, n.label]));
  const services = analysis?.service_count ?? nodes.filter((n) => n.type === "service").length;
  const databases = analysis?.database_count ?? nodes.filter((n) => n.type === "database").length;
  const groups = analysis?.component_count;
  const cycles = analysis?.cycles ?? [];
  const warnings = analysis?.warnings ?? [];

  return (
    <section className="panel stats" aria-labelledby="stats-title">
      <h2 id="stats-title">Graph information</h2>
      <dl className="stats__grid">
        <div><dt>Services</dt><dd>{services}</dd></div>
        <div><dt>Databases</dt><dd>{databases}</dd></div>
        <div><dt>Connections</dt><dd>{edges.length}</dd></div>
        {groups !== undefined && <div><dt>Connected groups</dt><dd>{groups}</dd></div>}
      </dl>

      <h3>Architecture summary</h3>
      <p className="stats__summary">{summary}</p>

      {cycles.length > 0 && (
        <div className="notice notice--cycle">
          <h3>Circular dependencies</h3>
          <ul>
            {cycles.map((path, i) => (
              <li key={i}>{path.map((id) => label[id] ?? id).join(" → ")}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="notice">
          <h3>Validation notes</h3>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
