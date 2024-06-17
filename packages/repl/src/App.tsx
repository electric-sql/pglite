import { PGlite } from "@electric-sql/pglite";
import "./App.css";
import { Repl } from "./Repl";

const pg = new PGlite();

function App() {
  return (
    <div className="App">
      <Repl pg={pg} border />
    </div>
  );
}

export default App;
