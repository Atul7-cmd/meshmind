export default function Intro() {
  return (
    <section className="intro" id="how-it-works">
      <h1>Turn infrastructure descriptions into dependency graphs</h1>
      <p className="intro__lead">
        Describe your services and databases in plain English. MeshMind AI asks Gemini to extract the
        components and who depends on whom, checks the result, and draws it as a graph you can explore.
      </p>
      <ol className="steps">
        <li>
          <strong>Describe</strong>
          <span>Write how your services and databases talk to each other.</span>
        </li>
        <li>
          <strong>Extract</strong>
          <span>The backend sends it to Gemini and validates the JSON it returns.</span>
        </li>
        <li>
          <strong>Explore</strong>
          <span>Select nodes, drag them around, zoom, and export the JSON.</span>
        </li>
      </ol>
    </section>
  );
}
