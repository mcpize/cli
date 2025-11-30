import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface GitInfo {
  sha: string;
  branch: string;
  author: string;
  message: string;
  repoFullName?: string;
}

async function execGit(command: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function getGitInfo(cwd: string): Promise<GitInfo | null> {
  const sha = await execGit("git rev-parse HEAD", cwd);

  if (!sha) {
    return null; // Not a git repo
  }

  const branch = await execGit("git rev-parse --abbrev-ref HEAD", cwd);
  const author = await execGit('git log -1 --format="%an"', cwd);
  const message = await execGit('git log -1 --format="%s"', cwd);

  // Try to get GitHub repo info
  const remote = await execGit("git remote get-url origin", cwd);
  let repoFullName: string | undefined;

  if (remote) {
    // Match: https://github.com/user/repo.git or git@github.com:user/repo.git
    const match = remote.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    if (match) {
      repoFullName = `${match[1]}/${match[2].replace(".git", "")}`;
    }
  }

  return {
    sha: sha.slice(0, 7), // Short SHA
    branch,
    author,
    message,
    repoFullName,
  };
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await execGit("git rev-parse --is-inside-work-tree", cwd);
  return result === "true";
}
