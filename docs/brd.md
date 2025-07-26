# Business Requirements Document (BRD)

## 1. Introduction

This Business Requirements Document outlines the functional and non-functional requirements for the Gitleaks Python Scanner. The primary goal of this tool is to automate the process of identifying sensitive information (secrets) within Git repositories to enhance security posture and compliance.

## 2. Business Goals

*   Automate secret scanning across multiple Git repositories.
*   Provide clear and actionable reports of identified secrets.
*   Improve the efficiency of security audits and vulnerability assessments.
*   Reduce the risk of accidental exposure of sensitive data.
*   Support compliance requirements related to data security.

## 3. Functional Requirements

### 3.1. Repository Scanning

*   The system SHALL be able to read a list of target Git repositories from a CSV file.
*   The system SHALL be able to clone Git repositories, including support for specific branches and commit IDs.
*   The system SHALL utilize the Dockerized Gitleaks tool to perform secret scanning on cloned repositories.
*   The system SHALL handle both shallow and full clones of repositories as needed for commit checkout.

### 3.2. Reporting

*   The system SHALL generate detailed JSON reports from Gitleaks scans.
*   The system SHALL generate human-readable HTML reports from the JSON output, including project information, leak summaries, and detailed findings with links to the source code.
*   The system SHALL generate Excel reports from the JSON output, including an executive summary and detailed findings with hyperlinks to the source code.
*   The system SHALL allow the user to optionally enable or disable HTML report generation.
*   The system SHALL allow the user to optionally enable or disable Excel report generation.
*   The system SHALL generate a summary CSV file (`gitleaks_summary.csv`) containing high-level scan results for each project (e.g., project name, leak count, report file path).
*   The system SHALL generate a failures CSV file (`gitleaks_failures.csv`) to log any issues encountered during cloning or scanning.

### 3.3. Data Management

*   The system SHALL store raw JSON reports in a designated directory.
*   The system SHALL securely clean up temporary cloned repositories after scanning.

### 3.4. Configuration

*   The system SHALL allow configuration of Gitleaks Docker image, temporary directories, and clone depth.

## 4. Non-Functional Requirements

### 4.1. Performance

*   The system SHOULD efficiently scan repositories, with performance being dependent on repository size and network speed.

### 4.2. Security

*   The system SHALL securely handle temporary repository clones and sensitive data within reports.
*   The system SHALL ensure that no sensitive information is inadvertently exposed through logs or temporary files.

### 4.3. Usability

*   The system SHALL provide clear command-line output during the scanning process.
*   Generated reports SHALL be easy to understand and navigate.

### 4.4. Maintainability

*   The codebase SHOULD be modular and well-structured for ease of maintenance and future enhancements.
*   Dependencies SHALL be managed through a `requirements.txt` file.

### 4.5. Scalability

*   The system SHOULD be designed to handle an increasing number of repositories, though current implementation is sequential.

## 5. Scope

This document covers the automated secret scanning of Git repositories using Gitleaks, report generation, and basic logging. It does not cover advanced features such as integration with CI/CD pipelines, real-time monitoring, or advanced vulnerability management platforms.
