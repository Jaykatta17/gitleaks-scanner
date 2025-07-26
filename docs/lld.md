# Low-Level Design (LLD) Document

## 1. Introduction

This Low-Level Design (LLD) document provides detailed design specifications for the modules and functions within the Gitleaks Python Scanner. It describes the classes, methods, their parameters, return types, and internal logic.

## 2. Module: `main.py`

### Function: `main()`

-   **Purpose**: Orchestrates the entire Gitleaks scanning process.
-   **Parameters**: None.
-   **Returns**: None.
-   **Logic**:
    1.  Define configuration variables (CSV_FILE, WORKDIR, REPORT_DIR, RAW_DATA_DIR, TMPDIR, GITLEAKS_IMAGE, SECURE_DELETE, CLONE_DEPTH, GENERATE_HTML_REPORT, GENERATE_EXCEL_REPORT).
    2.  Create necessary directories (`REPORT_DIR`, `TMPDIR`, `RAW_DATA_DIR`).
    3.  Initialize `gitleaks_failures.csv` and `gitleaks_summary.csv` with headers.
    4.  Read `target_projects.csv` into a pandas DataFrame.
    5.  Iterate through each row (project) in the DataFrame:
        a.  Extract project details (project_id, project_name, git_url, branch, commit_id, maintainer, assessment_type).
        b.  Generate `project_uid` and `safe_project_name`.
        c.  Construct `repo_dir`, `report_json_filename`, `report_json_path`.
        d.  Print scan progress.
        e.  Instantiate `GitleaksScanner`.
        f.  Call `scanner.clone_and_checkout()` to clone the repository and get the final commit ID.
        g.  If cloning fails, log failure and continue to next project.
        h.  Call `scanner.run_gitleaks_scan()`.
        i.  If scan is successful, read the JSON report to determine `leak_count`.
        j.  If `GENERATE_HTML_REPORT` is True, instantiate `ReportGenerator` and call `generate_html_report()`.
        k.  Move the raw JSON report to `RAW_DATA_DIR`.
        l.  If `GENERATE_EXCEL_REPORT` is True, instantiate `ExcelReportGenerator` and call `generate_excel_report()`.
        m.  Call `log_summary()` to record scan results.
        n.  Call `scanner.secure_cleanup()` to remove the temporary repository.
    6.  Print completion message.

## 3. Module: `gitleaks_scanner.py`

### Class: `GitleaksScanner`

-   **Constructor**: `__init__(self, gitleaks_image: str, tmp_dir: str, report_dir: str, raw_data_dir: str, secure_delete: bool, clone_depth: int)`
    -   **Purpose**: Initializes the scanner with configuration parameters.

### Method: `_clone_repo(self, git_url: str, repo_path: str, branch: str) -> bool`

-   **Purpose**: Clones a Git repository.
-   **Parameters**: `git_url`, `repo_path`, `branch`.
-   **Returns**: `True` on success, `False` on failure.
-   **Logic**: Uses `GitPython.Repo.clone_from()`.

### Method: `_checkout_commit(self, repo_path: str, commit_id: str) -> bool`

-   **Purpose**: Checks out a specific commit in a cloned repository.
-   **Parameters**: `repo_path`, `commit_id`.
-   **Returns**: `True` on success, `False` on failure.
-   **Logic**: Uses `GitPython.Repo.git.checkout()`.

### Method: `clone_and_checkout(self, git_url: str, branch: str, commit_id: str, repo_dir: str, project_id: str, project_name: str) -> tuple[str | None, str]`

-   **Purpose**: Clones a repository and attempts to checkout a specific commit.
-   **Parameters**: `git_url`, `branch`, `commit_id`, `repo_dir`, `project_id`, `project_name`.
-   **Returns**: Tuple of `(cloned_repo_path, final_commit_id)`.
-   **Logic**:
    1.  Call `_clone_repo()`.
    2.  Get current HEAD commit ID.
    3.  If `commit_id` is provided and is a full SHA (40 chars), trim to 8 chars.
    4.  If `commit_id` is provided, attempt `_checkout_commit()`.
    5.  If checkout fails, perform a full clone and retry checkout.
    6.  If no valid `commit_id` is provided, use the latest HEAD.

### Method: `run_gitleaks_scan(self, repo_path: str, report_filename: str) -> bool`

-   **Purpose**: Executes the Dockerized Gitleaks scan.
-   **Parameters**: `repo_path`, `report_filename`.
-   **Returns**: `True` if Gitleaks command executes (regardless of leaks), `False` on Docker execution error.
-   **Logic**: Uses `subprocess.run()` to execute Docker command. Checks `returncode` (0 for no leaks, 1 for leaks, >1 for errors).

### Method: `secure_cleanup(self, path: str)`

-   **Purpose**: Deletes the temporary cloned repository.
-   **Parameters**: `path`.
-   **Returns**: None.
-   **Logic**: Uses `shutil.rmtree()`. Includes a placeholder for secure deletion if `secure_delete` is True.

## 4. Module: `report_generator.py`

### Class: `ReportGenerator`

-   **Constructor**: `__init__(self, workdir: str, csv_file: str)`
    -   **Purpose**: Initializes the HTML report generator.

### Method: `generate_html_report(self, json_file: str, html_file: str, project_uid: str, project_name: str, branch: str, commit: str, spoc: str)`

-   **Purpose**: Generates an HTML report from Gitleaks JSON output.
-   **Parameters**: `json_file`, `html_file`, `project_uid`, `project_name`, `branch`, `commit`, `spoc`.
-   **Returns**: None.
-   **Logic**:
    1.  Load Gitleaks JSON data.
    2.  Read `target_projects.csv` to get `repo_base_url` for hyperlinks.
    3.  Calculate `total_leaks` and `rule_summary`.
    4.  Prepare `findings_data` including `ViewLink` for each finding.
    5.  Render HTML using a Jinja2 template string.
    6.  Save the rendered HTML to `html_file`.

## 5. Module: `excel_report_generator.py`

### Class: `ExcelReportGenerator`

-   **Constructor**: `__init__(self, workdir: str, template_path: str, csv_file: str)`
    -   **Purpose**: Initializes the Excel report generator.

### Method: `generate_excel_report(self, json_file: str, excel_file: str, project_uid: str, project_name: str, branch: str, commit: str, spoc: str, leak_count: int, assessment_type: str)`

-   **Purpose**: Generates an Excel report from Gitleaks JSON output using a template.
-   **Parameters**: `json_file`, `excel_file`, `project_uid`, `project_name`, `branch`, `commit`, `spoc`, `leak_count`, `assessment_type`.
-   **Returns**: None.
-   **Logic**:
    1.  Load the Excel template (`template_path`).
    2.  Load Gitleaks JSON data.
    3.  Populate "Executive_Summary" sheet cells (D4-D11) with provided project and scan details.
    4.  Populate "Actual_Findings" sheet:
        a.  Define headers.
        b.  Apply header styling.
        c.  Read `target_projects.csv` to get `repo_base_url` for hyperlinks.
        d.  Iterate through findings:
            i.   Append finding data to the sheet.
            ii.  Add hyperlink to "File" column cell.
            iii. Add hyperlink to "ViewLink" column cell.
            iv.  Set default "Status" to "Open".
        e.  Add data validation for "Status" column ("Open", "Closed").
        f.  Auto-fit column widths.
    5.  Save the populated workbook to `excel_file`.

## 6. Module: `utils.py`

### Function: `sanitize_name(name: str) -> str`

-   **Purpose**: Sanitizes a string for use in file names/paths.
-   **Parameters**: `name`.
-   **Returns**: Sanitized string.
-   **Logic**: Replaces non-alphanumeric characters with underscores.

### Function: `generate_uid() -> str`

-   **Purpose**: Generates a unique ID for scans.
-   **Parameters**: None.
-   **Returns**: Unique ID string.
-   **Logic**: Combines date and a UUID hex string.

### Function: `log_failure(workdir: str, project_id: str, project_name: str, branch: str, commit_id: str, status: str)`

-   **Purpose**: Logs details of a failed scan to `gitleaks_failures.csv`.
-   **Parameters**: `workdir`, `project_id`, `project_name`, `branch`, `commit_id`, `status`.
-   **Returns**: None.
-   **Logic**: Appends a new row to the CSV using pandas.

### Function: `log_summary(workdir: str, scan_id: str, project_id: str, project_name: str, branch: str, commit_id: str, repo_url: str, leak_count: int, assessment_type: str, maintainer: str, report_file: str)`

-   **Purpose**: Logs summary details of a scan to `gitleaks_summary.csv`.
-   **Parameters**: `workdir`, `scan_id`, `project_id`, `project_name`, `branch`, `commit_id`, `repo_url`, `leak_count`, `assessment_type`, `maintainer`, `report_file`.
-   **Returns**: None.
-   **Logic**: Appends a new row to the CSV using pandas.
