import { execSync } from "child_process";

try {
  execSync("npm run lint", { stdio: "inherit" });
} catch {
  // ignore lint errors to keep watcher alive
}
