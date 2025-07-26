import os
import pandas as pd
from gitleaks_scanner import GitleaksScanner
from report_generator import ReportGenerator
from excel_report_generator import ExcelReportGenerator
from utils import generate_uid, sanitize_name, log_failure, log_summary

# ---------------- CONFIG ----------------
CSV_FILE = "data/target_projects.csv"
WORKDIR = os.getcwd()
REPORT_DIR = os.path.join(WORKDIR, "Reports", "gitleaks-reports")
RAW_DATA_DIR = os.path.join(WORKDIR, "Reports", "json-reports")
TMPDIR = os.path.join(WORKDIR, "tmp")
GITLEAKS_IMAGE = "zricethezav/gitleaks"
SECURE_DELETE = True
CLONE_DEPTH = 50
GENERATE_HTML_REPORT = False # New flag to control HTML report generation
GENERATE_EXCEL_REPORT = True # New flag to control Excel report generation
# ----------------------------------------

def main():
    os.makedirs(REPORT_DIR, exist_ok=True)
    os.makedirs(TMPDIR, exist_ok=True)
    os.makedirs(RAW_DATA_DIR, exist_ok=True)

    # Initialize CSV files
    pd.DataFrame(columns=["project_id", "project_name", "branch", "commit_id", "status"]).to_csv(
        os.path.join(WORKDIR, "Reports", "gitleaks_failures.csv"), index=False
    )
    pd.DataFrame(
        columns=[
            "Date", "Scan_id", "Project_id", "Project_name", "Repo_Url", "Branch", "Commit_id",
            "Leak_count", "Assessment_type", "Maintainer", "Report_file"
        ]
    ).to_csv(os.path.join(WORKDIR, "Reports", "gitleaks_summary.csv"), index=False)

    try:
        projects_df = pd.read_csv(os.path.join(WORKDIR, CSV_FILE))
    except FileNotFoundError:
        print(f"ERROR: {CSV_FILE} not found.")
        return

    project_count = 0
    for index, row in projects_df.iterrows():
        project_count += 1
        project_id = row["project_id"]
        project_name = row["project_name"]
        git_url = row["git_url"]
        branch = row["branch"]
        commit_id = str(row["commit_id"]) if pd.notna(row["commit_id"]) else ""
        maintainer = row["maintainer"]
        assessment_type = row["assessment_type"]

        project_uid = generate_uid()
        safe_project_name = sanitize_name(project_name)

        repo_dir = os.path.join(TMPDIR, f"{project_uid}_{safe_project_name}")
        report_json_filename = f"{project_uid}_{safe_project_name}_Report.json"
        report_json_path = os.path.join(REPORT_DIR, report_json_filename)

        print(f"[{project_count}] Scanning: {project_name} ({branch})")
        print(f"Initial Commit ID: {commit_id if commit_id else '<none>'}")
        print(f"Report UID: {project_uid}")

        scanner = GitleaksScanner(
            gitleaks_image=GITLEAKS_IMAGE,
            tmp_dir=TMPDIR,
            report_dir=REPORT_DIR,
            raw_data_dir=RAW_DATA_DIR,
            secure_delete=SECURE_DELETE,
            clone_depth=CLONE_DEPTH
        )

        cloned_repo_path, final_commit_id = scanner.clone_and_checkout(
            git_url, branch, commit_id, repo_dir, project_id, project_name
        )

        if not cloned_repo_path:
            log_failure(
                WORKDIR, project_id, project_name, branch, commit_id, "CLONE_FAILED"
            )
            continue

        leak_count = 0
        if scanner.run_gitleaks_scan(cloned_repo_path, report_json_filename):
            try:
                with open(report_json_path, 'r') as f:
                    import json
                    leak_data = json.load(f)
                    leak_count = len(leak_data)
                if leak_count > 0:
                    print(f"Secrets found in {project_name}: {leak_count} leaks")
                else:
                    print(f"No secrets found in {project_name}")
            except (FileNotFoundError, json.JSONDecodeError) as e:
                print(f"Error reading Gitleaks report for {project_name}: {e}")
                leak_count = "ERROR"
                log_failure(
                    WORKDIR, project_id, project_name, branch, final_commit_id, "GITLEAKS_ERROR"
                )
        else:
            leak_count = "ERROR"
            log_failure(
                WORKDIR, project_id, project_name, branch, final_commit_id, "GITLEAKS_ERROR"
            )

        html_report_filename = ""
        if GENERATE_HTML_REPORT:
            html_report_filename = f"{project_uid}_{safe_project_name}_Report.html"
            html_report_path = os.path.join(REPORT_DIR, html_report_filename)

            reporter = ReportGenerator(WORKDIR, CSV_FILE)
            reporter.generate_html_report(
                report_json_path,
                html_report_path,
                project_uid,
                project_name,
                branch,
                final_commit_id,
                maintainer
            )
            print(f"Generated HTML Report: {html_report_path}")

        # Move JSON report to raw_data/
        if os.path.exists(report_json_path):
            os.rename(report_json_path, os.path.join(RAW_DATA_DIR, report_json_filename))
            print("Moved JSON report to raw_data/")

        if GENERATE_EXCEL_REPORT:
            excel_report_filename = f"{project_uid}_{safe_project_name}_Report.xlsx"
            excel_report_path = os.path.join(REPORT_DIR, excel_report_filename)
            excel_template_path = os.path.join(WORKDIR, "template", "report_template.xlsx")

            excel_reporter = ExcelReportGenerator(WORKDIR, excel_template_path, CSV_FILE)
            excel_reporter.generate_excel_report(
                os.path.join(RAW_DATA_DIR, report_json_filename), # Use the moved JSON file
                excel_report_path,
                project_uid,
                project_name,
                branch,
                final_commit_id,
                maintainer,
                leak_count,
                assessment_type
            )

        log_summary(
            WORKDIR,
            project_uid, project_id, project_name, branch, final_commit_id,
            git_url, leak_count, assessment_type, maintainer,
            excel_report_filename if GENERATE_EXCEL_REPORT else html_report_filename
        )

        print(f"Cleaning up: {cloned_repo_path}")
        scanner.secure_cleanup(cloned_repo_path)

    print(f"Completed scanning {project_count} project(s).")
    print(f"Reports saved in: {REPORT_DIR}")

if __name__ == "__main__":
    main()
