import { useCallback, useEffect, useRef, useState } from "react";
import Navbar from "./components/Navbar.jsx";
import Intro from "./components/Intro.jsx";
import InputPanel from "./components/InputPanel.jsx";
import GraphCanvas from "./components/GraphCanvas.jsx";
import StatsPanel from "./components/StatsPanel.jsx";
import NodeDetails from "./components/NodeDetails.jsx";
import JsonViewer from "./components/JsonViewer.jsx";
import ErrorBanner from "./components/ErrorBanner.jsx";
import { checkHealth, generateGraph, validateDescription } from "./services/api.js";
import { downloadJson } from "./services/exportJson.js";
import { EXAMPLE_DESCRIPTION } from "./services/constants.js";

export default function App() {
  const [description, setDescription] = useState("");
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [health, setHealth] = useState({ checked: false, online: false, geminiConfigured: false });
  const requestId = useRef(0); // lets us ignore answers that arrive after Clear or a newer request

  const refreshHealth = useCallback(() => {
    checkHealth().then((h) => setHealth({ checked: true, ...h }));
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const run = useCallback(
    async (text) => {
      const problem = validateDescription(text);
      if (problem) {
        setValidation(problem);
        return;
      }
      setValidation("");
      setError("");
      const id = ++requestId.current;
      setLoading(true);
      setLastSubmitted(text.trim());
      try {
        const data = await generateGraph(text);
        if (id !== requestId.current) return;
        setGraph(data);
        setSelectedId(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err.message || "Something went wrong. Please try again.");
      } finally {
        if (id === requestId.current) setLoading(false);
        refreshHealth();
      }
    },
    [refreshHealth]
  );

  const clearGraph = useCallback(() => {
    requestId.current++;
    setGraph(null);
    setSelectedId(null);
    setError("");
    setLoading(false);
  }, []);

  const clearAll = useCallback(() => {
    clearGraph();
    setDescription("");
    setValidation("");
    setLastSubmitted("");
  }, [clearGraph]);

  const exportJson = useCallback(() => {
    if (graph) downloadJson(graph);
  }, [graph]);

  return (
    <>
      <Navbar health={health} />
      <main className="page" id="top">
        <Intro />
        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        <div className="workspace" id="workspace">
          <InputPanel
            value={description}
            onChange={(v) => {
              setDescription(v);
              if (validation) setValidation("");
            }}
            onGenerate={() => run(description)}
            onClear={clearAll}
            onExample={() => {
              setDescription(EXAMPLE_DESCRIPTION);
              setValidation("");
            }}
            loading={loading}
            validation={validation}
          />
          <GraphCanvas
            graph={graph}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={loading}
            canRegenerate={Boolean(lastSubmitted) && !loading}
            onRegenerate={() => run(lastSubmitted)}
            onExport={exportJson}
            onClearGraph={clearGraph}
          />
        </div>
        {graph && (
          <section className="details" aria-label="Graph details">
            <StatsPanel graph={graph} />
            <NodeDetails graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
            <JsonViewer graph={graph} onExport={exportJson} />
          </section>
        )}
      </main>
      <footer className="footer">
        MeshMind AI. Descriptions are processed in memory and are not stored by this application.
      </footer>
    </>
  );
}
