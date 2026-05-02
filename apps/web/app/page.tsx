const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8020";

async function getMatches() {
  const res = await fetch(`${API}/matches/default?k=10`, { cache: "no-store" });
  return res.json();
}

export default async function Home() {
  const data = await getMatches();
  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 32, maxWidth: 1180, margin: "0 auto" }}>
      <h1>JobGraph AI</h1>
      <p>Agentic job-search copilot with real-time ingestion, graph matching, resume intelligence, tracker, and autofill prep.</p>
      <section style={{ display: "grid", gap: 16 }}>
        {data.matches?.map((match: any) => (
          <article key={match.job.job_id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <h2 style={{ margin: 0 }}>{match.job.title}</h2>
                <p style={{ margin: "4px 0", color: "#555" }}>{match.job.company} | {match.job.location} | {match.job.source}</p>
              </div>
              <strong>{match.score}% match</strong>
            </div>
            <p>{match.explanation}</p>
            <small>Job ID: {match.job.job_id}</small>
          </article>
        ))}
      </section>
    </main>
  );
}
