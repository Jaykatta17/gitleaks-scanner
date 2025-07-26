# Architecture Document

## 1. Overview

The Gitleaks Python Scanner is designed to automate the process of scanning Git repositories for sensitive information (secrets) using a Dockerized Gitleaks tool. It generates comprehensive reports in various formats, including HTML, Excel, and CSV summaries, to facilitate analysis and tracking of identified leaks.

## 2. High-Level Architecture

The system follows a modular architecture, separating concerns into distinct Python modules and leveraging external tools for core functionalities.

```
+-----------------------+     +---------------------+     +------------------------+
|  target_projects.csv  |     |                     |     |                        |
|  (Input Data)         |---->|      main.py        |---->|     GitleaksScanner    |
+-----------------------+     |  (Orchestrator)     |     |  (Repo Mgmt, Gitleaks) |
                              +----------|----------+     +----------|-------------+
                                         |                           |
                                         |                           |
                                         v                           v
                              +---------------------+     +-----------------------+
                              |      utils.py       |     |       Docker          |
                              |  (Helper Functions) |     |  (Gitleaks Container) |
                              +----------|----------+     +----------|------------+
                                         |                           |
                                         |                           |
                                         v                           v
                              +---------------------+     +---------------------------+
                              |  report_generator.py|     | excel_report_generator.py |
                              |  (HTML Report Gen)  |     |  (Excel Report Gen)       |
                              +----------|----------+     +------------|--------------+
                                         |                             |
                                         v                             v
                              +-----------------------+     +------------------------+
                              |  gitleaks-reports/    |     |  gitleaks_summary.csv  |
                              |  (HTML/Excel Reports) |     |  gitleaks_failures.csv |
                              +-----------------------+     +------------------------+
```

## 3. Component Breakdown

### 3.1. `main.py` (Orchestrator)

-   **Role**: The primary entry point of the application. It reads the `data/target_projects.csv`, iterates through each project, and orchestrates the scanning and reporting process.
-   **Key Responsibilities**:
    -   Initializes output directories (`Reports/gitleaks-reports`, `Reports/json-reports`, `tmp`).
    -   Initializes `gitleaks_failures.csv` and `gitleaks_summary.csv`.
    -   Parses project details from `data/target_projects.csv`.
    -   Instantiates and calls `GitleaksScanner` for repository cloning and Gitleaks execution.
    -   Handles Gitleaks scan results, including error handling and leak counting.
    -   Conditionally calls `ReportGenerator` (for HTML) and `ExcelReportGenerator` (for Excel) based on configuration flags.
    -   Logs scan summaries and failures using `utils.py` functions.
    -   Manages temporary directory cleanup.

### 3.2. `gitleaks_scanner.py`

-   **Role**: Manages Git repository operations (cloning, checking out commits) and executes the Dockerized Gitleaks scan.
-   **Key Responsibilities**:
    -   Clones Git repositories using `GitPython`.
    -   Handles specific commit checkouts, including full clones if a shallow clone fails to checkout a specific commit.
    -   Executes the `gitleaks` Docker container, mapping necessary volumes for source code and reports.
    -   Interprets Gitleaks Docker command exit codes to determine scan success and leak presence.
    -   Provides secure cleanup of cloned repositories.

### 3.3. `report_generator.py`

-   **Role**: Generates detailed HTML reports from Gitleaks JSON output.
-   **Key Responsibilities**:
    -   Reads Gitleaks JSON report files.
    -   Uses `Jinja2` templating to render HTML reports with project information, leak summaries, and detailed findings.
    -   Calculates leak counts per rule.
    -   Generates hyperlinks to repository files for direct navigation to identified secrets.

### 3.4. `excel_report_generator.py`

-   **Role**: Generates detailed Excel reports from Gitleaks JSON output using a predefined template.
-   **Key Responsibilities**:
    -   Loads an Excel template (`template/report_template.xlsx`).
    -   Populates an "Executive_Summary" sheet with high-level scan information.
    -   Populates an "Actual_Findings" sheet with detailed findings, including data validation and hyperlinks.
    -   Auto-fits column widths for better readability.

### 3.5. `utils.py`

-   **Role**: Provides common utility functions used across different modules.
-   **Key Responsibilities**:
    -   `sanitize_name()`: Cleans up project names for use in file paths.
    -   `generate_uid()`: Generates unique scan IDs.
    -   `log_failure()`: Appends failed scan details to `Reports/gitleaks_failures.csv`.
    -   `log_summary()`: Appends successful scan summaries to `Reports/gitleaks_summary.csv`.

## 4. Data Flow

1.  **Input**: The `main.py` script reads project details from `data/target_projects.csv`.
2.  **Repository Cloning**: For each project, `GitleaksScanner` clones the specified Git repository into a temporary directory (`tmp/`).
3.  **Gitleaks Scan**: `GitleaksScanner` executes the Dockerized Gitleaks tool against the cloned repository. Gitleaks outputs a raw JSON report to `Reports/json-reports/`.
4.  **JSON Processing**: After the scan, the raw JSON report is moved from `Reports/gitleaks-reports/` to `Reports/json-reports/`.
5.  **Report Generation**:
    -   If enabled, `ReportGenerator` reads the JSON report and creates an HTML report in `Reports/gitleaks-reports/`.
    -   If enabled, `ExcelReportGenerator` reads the JSON report and the `template/report_template.xlsx`, then generates an Excel report in `Reports/gitleaks-reports/`.
6.  **Logging**: `utils.py` functions append scan results (successes and failures) to `Reports/gitleaks_summary.csv` and `Reports/gitleaks_failures.csv` respectively.
7.  **Cleanup**: The temporary cloned repository is securely deleted by `GitleaksScanner`.

## 5. External Dependencies

-   **Docker**: Used to run the Gitleaks security scanning tool.
-   **GitPython**: Python library for interacting with Git repositories.
-   **pandas**: Python library for data manipulation, used for reading/writing CSVs and data processing.
-   **Jinja2**: Python templating engine used for generating HTML reports.
-   **openpyxl**: Python library for reading and writing Excel 2010 xlsx/xlsm/xltx/xltm files.
-   **python-gitlab**: (Not directly used in the provided code, but mentioned in original `glab` context, so kept for completeness if future GitLab API interaction is needed).

## 6. Future Considerations

-   **Error Handling**: Enhance error handling for network issues, Docker failures, and file I/O.
-   **Configuration Management**: Externalize configuration settings (e.g., `config.ini` or environment variables) for easier deployment and management.
-   **Scalability**: Consider parallel processing for scanning multiple repositories simultaneously.
-   **Reporting**: Add more customizable reporting options and integrate with external reporting tools.
-   **Security**: Implement more robust secure deletion methods if required for highly sensitive data.