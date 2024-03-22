import { exec } from "child_process";

// Get the file path from the command line arguments
const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node script.js <path_to_wasm_file>");
  process.exit(1);
}

// Construct the wasm-objdump command
const command = `wasm-objdump --details ${filePath}`;

// Execute the wasm-objdump command
exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`exec error: ${error}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
    return;
  }

  // Process the output from stdout
  const lines = stdout.split("\n");
  let inImportSection = false;
  const imports = [];

  // lines.forEach(line => {
  for (const line of lines) {
    // Check if we've reached the "Import" section
    if (line.startsWith("Import[")) {
      inImportSection = true;
    } else if (inImportSection) {
      // Check if we've reached the end of the "Import" section
      if (!line.startsWith(" - ")) {
        break;
      } else if (line.includes(".")) {
        imports.push(line.substring(line.lastIndexOf(".") + 1));
      }
    }
  }

  // Output the extracted symbols
  imports.forEach((importSymbol) => console.log(`_${importSymbol}`));
});
