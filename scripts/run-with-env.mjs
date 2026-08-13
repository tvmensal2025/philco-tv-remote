import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const childEnv = { ...process.env };
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) childEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const npmCli = process.env.npm_execpath;
const child = npmCli
  ? spawn(process.execPath, [npmCli, ...process.argv.slice(2)], { env: childEnv, stdio: "inherit", shell: false })
  : spawn(process.platform === "win32" ? "npm.cmd" : "npm", process.argv.slice(2), { env: childEnv, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
