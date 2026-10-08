// Starts the Python API server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const uvicorn = join(root, "server", ".venv", "bin", "uvicorn");
if (!existsSync(uvicorn)) {
  console.error("Python environment missing — run `npm run setup` first.");
  process.exit(1);
}

const procs = [
  { name: "server", color: 36, cmd: uvicorn, args: ["app.main:app", "--host", "127.0.0.1", "--port", "8000"], cwd: join(root, "server") },
  { name: "web", color: 35, cmd: "npm", args: ["run", "dev"], cwd: join(root, "web") },
];

const children = procs.map(({ name, color, cmd, args, cwd }) => {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: "1" } });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) out.write(tag + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${tag}exited (${code ?? "signal"})`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
