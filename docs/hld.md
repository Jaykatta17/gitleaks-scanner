# High-Level Design (HLD) Document

## 1. Introduction

This High-Level Design (HLD) document provides an architectural overview of the Gitleaks Python Scanner. It describes the main components, their responsibilities, and how they interact to achieve the system's objectives.

## 2. System Context

The Gitleaks Python Scanner operates as a standalone application that interacts with Git repositories (e.g., GitLab) and the Docker environment to perform secret scanning. It consumes a CSV file as input and produces various reports as output.

## 3. Architectural Style

This system primarily follows a **Modular Architecture** with clear separation of concerns. Each core functionality (scanning, HTML reporting, Excel reporting, utilities) is encapsulated within its own Python module. The `main.py` acts as an orchestrator, coordinating the flow between these modules.

## 4. Major Components

### 4.1. Main Orchestrator (`main.py`)

-   **Purpose**: Drives the entire scanning workflow.
-   **Responsibilities**:
    -   Reads configuration and input data.
    -   Manages the lifecycle of each project scan.
    -   Delegates tasks to specialized modules.
    -   Aggregates results and performs final logging.
-   **Inputs**: `data/target_projects.csv`.
-   **Outputs**: Orchestrates generation of various reports and logs.

### 4.2. Gitleaks Scanner (`gitleaks_scanner.py`)

-   **Purpose**: Handles all Git repository interactions and Gitleaks execution.
-   **Responsibilities**:
    -   Cloning repositories (shallow and full).
    -   Checking out specific commits.
    -   Invoking the Dockerized Gitleaks tool.
    -   Managing temporary cloned repositories.
-   **Dependencies**: `GitPython`, `Docker` (via `subprocess`).

### 4.3. HTML Report Generator (`report_generator.py`)

-   **Purpose**: Transforms raw Gitleaks JSON output into a user-friendly HTML report.
-   **Responsibilities**:
    -   Parses Gitleaks JSON data.
    -   Applies HTML templates to format the data.
    -   Generates interactive elements (e.g., show/hide secret details).
    -   Creates hyperlinks to source code locations.
-   **Dependencies**: `Jinja2`.

### 4.4. Excel Report Generator (`excel_report_generator.py`)

-   **Purpose**: Creates structured Excel reports from Gitleaks JSON output using a template.
-   **Responsibilities**:
    -   Reads an Excel template.
    -   Populates executive summary details.
    -   Populates detailed findings with data validation and hyperlinks.
    -   Applies basic styling.
-   **Dependencies**: `openpyxl`, `pandas`.

### 4.5. Utilities (`utils.py`)

-   **Purpose**: Provides common helper functions used across the application.
-   **Responsibilities**:
    -   Generating unique IDs.
    -   Sanitizing strings for file paths.
    -   Logging scan failures and summaries to CSV files.
-   **Dependencies**: `pandas`, `uuid`, `re`.

## 5. Data Stores

-   **Input CSV (`data/target_projects.csv`)**: Defines projects to be scanned.
-   **Temporary Cloned Repositories (`tmp/`)**: Ephemeral storage for Git clones.
-   **Raw JSON Reports (`Reports/json-reports/`)**: Stores the direct output from Gitleaks.
-   **Generated Reports (`Reports/gitleaks-reports/`)**: Stores final HTML and Excel reports.
-   **Summary CSV (`Reports/gitleaks_summary.csv`)**: Logs high-level scan results.
-   **Failures CSV (`Reports/gitleaks_failures.csv`)**: Logs details of failed scans.
-   **Excel Template (`template/report_template.xlsx`)**: Pre-formatted Excel file for report generation.

## 6. External Interfaces

-   **Git Repositories**: Accessed via `GitPython` for cloning and fetching code.
-   **Docker**: Invoked via `subprocess` to run the Gitleaks container.
-   **User Interface**: Command-line interface for execution and progress monitoring.

## 7. Deployment Considerations

The application is designed to run in a Python 3 environment with required dependencies installed (preferably in a virtual environment). Docker must be installed and running on the host system to execute Gitleaks.
