import os
import subprocess
import shutil
from git import Repo, GitCommandError

class GitleaksScanner:
    def __init__(
        self,
        gitleaks_image: str,
        tmp_dir: str,
        report_dir: str,
        raw_data_dir: str,
        secure_delete: bool,
        clone_depth: int,
    ):
        self.gitleaks_image = gitleaks_image
        self.tmp_dir = tmp_dir
        self.report_dir = report_dir
        self.raw_data_dir = raw_data_dir
        self.secure_delete = secure_delete
        self.clone_depth = clone_depth

    def _clone_repo(self, git_url: str, repo_path: str, branch: str) -> bool:
        try:
            print(f"Cloning {git_url} branch {branch} to {repo_path}")
            Repo.clone_from(git_url, repo_path, branch=branch, depth=self.clone_depth)
            return True
        except GitCommandError as e:
            print(f"ERROR: Failed to clone {git_url} branch {branch}: {e}")
            return False

    def _checkout_commit(self, repo_path: str, commit_id: str) -> bool:
        try:
            repo = Repo(repo_path)
            repo.git.checkout(commit_id)
            print(f"Checked out commit {commit_id} in {repo_path}")
            return True
        except GitCommandError as e:
            print(f"ERROR: Failed to checkout commit {commit_id} in {repo_path}: {e}")
            return False

    def clone_and_checkout(
        self, git_url: str, branch: str, commit_id: str, repo_dir: str, project_id: str, project_name: str
    ) -> tuple[str | None, str]:
        if not self._clone_repo(git_url, repo_dir, branch):
            return None, ""

        final_commit_id = ""
        try:
            repo = Repo(repo_dir)
            final_commit_id = repo.head.commit.hexsha[:8]
        except GitCommandError as e:
            print(f"Warning: Could not get current commit ID: {e}")
            final_commit_id = "UNKNOWN"

        if commit_id and len(commit_id) == 40:
            commit_id = commit_id[:8]

        if commit_id and len(commit_id) >= 7:
            print(f"Attempting to checkout commit: {commit_id}")
            if not self._checkout_commit(repo_dir, commit_id):
                print("Retrying with full clone...")
                # If checkout fails, try a full clone and then checkout
                shutil.rmtree(repo_dir, ignore_errors=True)
                try:
                    repo = Repo.clone_from(git_url, repo_dir, branch=branch)
                    if not self._checkout_commit(repo_dir, commit_id):
                        print("Using latest on branch.")
                        final_commit_id = repo.head.commit.hexsha[:8]
                    else:
                        final_commit_id = commit_id
                except GitCommandError as e:
                    print(f"ERROR: Full clone failed: {e}")
                    return None, ""
            else:
                final_commit_id = commit_id
        else:
            print("No valid commit ID provided — using latest on branch")
            # final_commit_id is already set to HEAD if no commit_id was provided

        return repo_dir, final_commit_id

    def run_gitleaks_scan(self, repo_path: str, report_filename: str) -> bool:
        report_path = os.path.join(self.report_dir, report_filename)
        command = [
            "docker", "run", "--rm",
            "-v", f"{repo_path}:/repo",
            "-v", f"{self.report_dir}:/reports",
            self.gitleaks_image, "detect",
            f"--source=/repo",
            f"--report-path=/reports/{report_filename}",
            "--report-format", "json",
            "--no-git"
        ]
        try:
            print(f"Running Gitleaks scan on {repo_path}...")
            result = subprocess.run(command, check=False, capture_output=True, text=True)
            if result.returncode == 0:
                print(f"Gitleaks scan completed for {repo_path}. No secrets found by Gitleaks.")
                return True
            elif result.returncode == 1:
                print(f"Gitleaks scan completed for {repo_path}. Secrets found by Gitleaks.")
                return True
            else:
                print(f"Gitleaks scan failed for {repo_path} with exit code {result.returncode}: {result.stderr}")
                return False
        except Exception as e:
            print(f"Error running Gitleaks scan for {repo_path}: {e}")
            return False

    def secure_cleanup(self, path: str):
        if self.secure_delete:
            print(f"Securely deleting {path}...")
            try:
                # This is a simplified secure delete. For true secure delete, consider a dedicated tool.
                # For now, we'll just remove it.
                shutil.rmtree(path, ignore_errors=True)
            except OSError as e:
                print(f"Error during secure cleanup of {path}: {e}")
        else:
            print(f"Deleting {path}...")
            shutil.rmtree(path, ignore_errors=True)

        if os.path.exists(self.tmp_dir) and not os.listdir(self.tmp_dir):
            os.rmdir(self.tmp_dir)
