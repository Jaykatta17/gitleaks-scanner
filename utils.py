import os
import uuid
import re
import pandas as pd

def sanitize_name(name: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]', '_', name)

def generate_uid() -> str:
    return f"GITLEAKS-SECRETS-{pd.Timestamp.now().strftime("%Y%m%d")}-{uuid.uuid4().hex[:6].upper()}"

def log_failure(workdir: str, project_id: str, project_name: str, branch: str, commit_id: str, status: str):
    failures_csv = os.path.join(workdir, "gitleaks_failures.csv")
    df = pd.DataFrame([{
        "project_id": project_id,
        "project_name": project_name,
        "branch": branch,
        "commit_id": commit_id,
        "status": status
    }])
    df.to_csv(failures_csv, mode='a', header=False, index=False)

def log_summary(
    workdir: str, scan_id: str, project_id: str, project_name: str, branch: str, commit_id: str,
    repo_url: str, leak_count: int, assessment_type: str, maintainer: str, report_file: str
):
    summary_csv = os.path.join(workdir, "Reports", "gitleaks_summary.csv")
    df = pd.DataFrame([{
        "Date": pd.Timestamp.now().strftime("%Y-%m-%d"),
        "Scan_id": scan_id,
        "Project_id": project_id,
        "Project_name": project_name,
        "Repo_Url": repo_url,
        "Branch": branch,
        "Commit_id": commit_id,
        "Leak_count": leak_count,
        "Assessment_type": assessment_type,
        "Maintainer": maintainer,
        "Report_file": report_file
    }])
    df.to_csv(summary_csv, mode='a', header=False, index=False)
