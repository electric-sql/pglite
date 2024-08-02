{
  const originalConsoleLog = window.console.log;
  window.console.log = function (...args) {
    originalConsoleLog(...args);
    const log = document.getElementById("log");
    const el = document.createElement("div");
    el.classList.add("log-entry");
    el.innerText +=
      typeof args[0] === "string"
        ? args.join(" ")
        : JSON.stringify(args[0], null, 2);
    log.appendChild(el);
  };

  document.addEventListener("DOMContentLoaded", async () => {
    document.body.querySelectorAll("script[src]").forEach(async (script) => {
      const source = fetch(script.src).then((res) => res.text());
      const code = await source;
      script.textContent = code;
    });
  });
}
