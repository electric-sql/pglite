import { createRoot } from "react-dom/client";
import { Repl } from "../src/Repl";
import type { ReplProps, ReplTheme } from "../src/Repl";
import type { PGlite } from "@electric-sql/pglite";
import type { Extension } from "@uiw/react-codemirror";

// @ts-ignore
import css from "../src/Repl.css?raw";

export type { ReplProps, ReplTheme };

export class PGliteREPL extends HTMLElement {
  #mountPoint: HTMLDivElement;
  #root: ReturnType<typeof createRoot>;
  #pg?: PGlite;
  #lightTheme?: Extension;
  #darkTheme?: Extension;

  constructor() {
    super();
    this.#mountPoint = document.createElement("div");
    const shadowRoot = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(this.#mountPoint);
    this.#root = createRoot(this.#mountPoint);
  }

  static get observedAttributes() {
    return ["border", "theme", "show-time", "disable-update-schema"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(_name: string, oldValue: any, newValue: any) {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  disconnectedCallback() {
    this.#root?.unmount();
  }

  get pg() {
    return this.#pg;
  }

  set pg(pg: PGlite | undefined) {
    this.#pg = pg;
    this.render();
  }

  get lightTheme() {
    return this.#lightTheme;
  }

  set lightTheme(lightTheme: Extension | undefined) {
    this.#lightTheme = lightTheme;
    this.render();
  }

  get darkTheme() {
    return this.#darkTheme;
  }

  set darkTheme(darkTheme: Extension | undefined) {
    this.#darkTheme = darkTheme;
    this.render();
  }

  render() {
    const border = this.hasAttribute("border")
      ? this.getAttribute("border") !== "false"
      : undefined;
    const theme = this.getAttribute("theme");
    const showTime = this.hasAttribute("show-time")
      ? this.getAttribute("show-time") !== "false"
      : undefined;
    const disableUpdateSchema = this.hasAttribute("disable-update-schema")
      ? this.getAttribute("disable-update-schema") !== "false"
      : undefined;

    const props: ReplProps = {
      pg: this.#pg!,
      border,
      lightTheme: this.#lightTheme,
      darkTheme: this.#darkTheme,
      theme: (theme as ReplTheme | null) || "auto",
      showTime,
      disableUpdateSchema,
    };

    this.#root.render(
      <>
        {this.#pg ? (
          <Repl {...props} />
        ) : (
          <div>PGlite instance not provided</div>
        )}
      </>,
    );
  }
}

customElements.define("pglite-repl", PGliteREPL);
