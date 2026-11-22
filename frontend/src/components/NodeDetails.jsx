export default function NodeDetails({ graph, selectedId, onSelect }) {
  const node = graph.nodes.find((n) => n.id === selectedId);
  const label = Object.fromEntries(graph.nodes.map((n) => [n.id, n.label]));

  if (!node) {
    return (
      <section className="panel node-details" aria-labelledby="node-title">
        <h2 id="node-title">Selected node</h2>
        <p className="text-muted">
          Select a node in the graph to see what it depends on and what depends on it.
        </p>
      </section>
    );
  }

  const dependsOn = graph.edges.filter((e) => e.source === node.id);
  const usedBy = graph.edges.filter((e) => e.target === node.id);

  const renderList = (items, otherEnd) =>
    items.length === 0 ? (
      <p className="text-muted">None</p>
    ) : (
      <ul className="link-list">
        {items.map((e, i) => (
          <li key={`${e.source}-${e.target}-${i}`}>
            <button type="button" className="link-btn" onClick={() => onSelect(e[otherEnd])}>
              {label[e[otherEnd]] ?? e[otherEnd]}
            </button>
            <span className="text-muted"> {e.label}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <section className="panel node-details" aria-labelledby="node-title">
      <h2 id="node-title">Selected node</h2>
      <p className="node-details__name">{node.label}</p>
      <p className="text-muted">
        {node.type === "database" ? "Database" : "Service"}, id <code>{node.id}</code>
      </p>
      <h3>Depends on</h3>
      {renderList(dependsOn, "target")}
      <h3>Used by</h3>
      {renderList(usedBy, "source")}
    </section>
  );
}
