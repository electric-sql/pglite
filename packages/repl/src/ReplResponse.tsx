import type { Results, Response } from "./types";
import { ReplTable } from "./ReplTable";

function OutLine({ result }: { result: Results }) {
  return (
    <div className="PGliteRepl-line">
      {result.fields.length > 0 ? (
        <ReplTable result={result} />
      ) : (
        <div className="PGliteRepl-null">null</div>
      )}
    </div>
  );
}

export function ReplResponse({
  response,
  showTime,
}: {
  response: Response;
  showTime: boolean;
}) {
  let out;
  if (response.error) {
    out = (
      <div className="PGliteRepl-line PGliteRepl-error">{response.error}</div>
    );
  } else {
    out = (
      <>
        {response.results?.map((result, i) => (
          <OutLine key={i} result={result} />
        ))}
      </>
    );
  }
  return (
    <>
      <pre className="PGliteRepl-line PGliteRepl-query">{response.query}</pre>
      {response.text && (
        <div className="PGliteRepl-line PGliteRepl-text">{response.text}</div>
      )}
      {out}
      <div className="PGliteRepl-divider">
        <hr />
        {showTime && (
          <div className="PGliteRepl-time">{response.time.toFixed(1)}ms</div>
        )}
      </div>
    </>
  );
}
