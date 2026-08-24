# 🧰 Gitleaks Python Scanner

A Python-based tool for automating Gitleaks scans on Git repositories.

---

## 📦 Project Overview

This project provides a Python script to scan multiple Git repositories for secrets using a Dockerized Gitleaks. It generates both JSON and HTML reports, along with summary and failure logs.

---

## 🛠️ Requirements

*   Python 3.x
*   `git`
*   `Docker` (for Gitleaks scanning)

### Python Dependencies

Install Python dependencies using pip:

```bash
pip install -r requirements.txt
```

---

## ▶️ How to Run

1.  **Prepare `target_projects.csv`**: Ensure your `target_projects.csv` file is located in the `data/` directory. An example format is provided below.

2.  **Run the Scanner**: Execute the `main.py` script using Python.

    ```bash
    .venv/bin/python main.py
    ```

    (Note: If you are not using a virtual environment, you might use `python3 main.py` or `python main.py` depending on your system configuration.)

---

## 📌 `main.py` – Scan Git Repos for Secrets

This is the main script that orchestrates the Gitleaks scanning process.

### 📥 Input: `data/target_projects.csv`

Create a `target_projects.csv` file in the `data/` directory with the following columns:

```csv
project_id,project_name,git_url,branch,commit_id,maintainer,assessment_type
101,My App,https://gitlab.com/example/my-app.git,main,,john@example.com,internal
```

*   `commit_id` is optional; if blank, HEAD is scanned.
*   `assessment_type` is a custom field for your reporting.

### ⚙️ Configurable Settings

Configuration settings are located at the top of `main.py`:

```python
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
```

### 📤 Output

*   `Reports/gitleaks-reports/` – Contains HTML and Excel reports for each project.
*   `Reports/json-reports/` - Contains the raw JSON reports from Gitleaks.
*   `Reports/gitleaks_summary.csv` – Summary of all scans (project name, leak count, report path).
*   `Reports/gitleaks_failures.csv` – Logs any failed clones or scans.

---

## 📚 Project Structure

*   `main.py`: Main script to run the Gitleaks scanner.
*   `gitleaks_scanner.py`: Contains the `GitleaksScanner` class for repository cloning and Gitleaks execution.
*   `report_generator.py`: Contains the `ReportGenerator` class for generating HTML reports.
*   `excel_report_generator.py`: Contains the `ExcelReportGenerator` class for generating Excel reports.
*   `utils.py`: Contains helper functions like `sanitize_name`, `generate_uid`, `log_failure`, and `log_summary`.
*   `requirements.txt`: Lists all Python dependencies.
*   `data/`: Directory for input CSV files (e.g., `target_projects.csv`).
*   `docs/`: Directory for project documentation (architecture, BRD, data flow, HLD, LLD).
*   `Reports/gitleaks-reports/`: Directory for generated HTML and Excel reports.
*   `Reports/json-reports/`: Directory for raw JSON Gitleaks reports.
*   `tmp/`: Temporary directory for cloned repositories.
*   `template/`: Directory for report templates (e.g., `report_template.xlsx`).

---

---

## 🖥️ Sentinel Console (web application)

`webapp/` contains an enterprise web application that turns this scanner into a
managed platform: onboard repositories, queue scans through Redis, triage the
findings and hand auditors a complete trail.

*   **Stack**: React + Material UI (light, glassmorphic) · Node.js + Express · MongoDB · Redis (BullMQ)
*   **Authentication**: local accounts **or** corporate LDAP/AD, optional TOTP MFA, lockout and password policy
*   **Notifications**: queued SMTP mail for scan results, critical findings and account events
*   **Auditing**: every action stored in MongoDB and mirrored to syslog (RFC 5424/3164)
*   **Scanning**: the same gitleaks engine, driven by workers (`mock`, `native` or `docker` driver)

```bash
cd webapp
cp server/.env.example server/.env    # set the two JWT secrets
docker compose up --build             # console on http://localhost:8080
docker compose exec api npm run seed  # demo users, projects and scans
```

See [`webapp/README.md`](webapp/README.md) for a local (non-container) setup, and
[`webapp/docs/`](webapp/docs) for the architecture and operations runbook.

---

## 💬 Notes

*   Gitleaks output includes HTML reports with line-level links back to GitLab commits (if commit ID is provided).
*   All outputs are CSV or HTML for easy review and integration.
