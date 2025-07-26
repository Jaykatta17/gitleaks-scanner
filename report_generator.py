import os
import json
import pandas as pd
from jinja2 import Environment, FileSystemLoader # type: ignore

class ReportGenerator:
    def __init__(self, workdir: str, csv_file: str):
        self.workdir = workdir
        self.csv_file = csv_file
        self.env = Environment(loader=FileSystemLoader(os.path.dirname(__file__)))

    def generate_html_report(
        self, json_file: str, html_file: str, project_uid: str, project_name: str,
        branch: str, commit: str, spoc: str
    ):
        if not os.path.exists(json_file):
            print(f"Warning: {json_file} not found. Skipping HTML generation.")
            return

        with open(json_file, 'r') as f:
            findings = json.load(f)

        repo_base_url = ""
        try:
            projects_df = pd.read_csv(os.path.join(self.workdir, self.csv_file))
            repo_base_url_series = projects_df.loc[projects_df["project_name"] == project_name, "git_url"]
            if not repo_base_url_series.empty:
                repo_base_url = repo_base_url_series.iloc[0].replace(".git", "")
        except FileNotFoundError:
            print(f"Warning: {self.csv_file} not found. Cannot determine repo_base_url.")

        generated_on = pd.Timestamp.now().strftime("%Y-%m-%d")
        total_leaks = len(findings)

        rule_summary = {}
        for finding in findings:
            rule_id = finding.get("RuleID", "N/A")
            rule_summary[rule_id] = rule_summary.get(rule_id, 0) + 1

        findings_data = []
        for finding in findings:
            rule_id = finding.get("RuleID", "N/A")
            description = finding.get("Description", "N/A")
            file = finding.get("File", "N/A").replace("/repo", "")
            start_line = finding.get("StartLine", "N/A")
            secret = finding.get("Secret", "N/A")
            author = finding.get("Author", "N/A")
            date = finding.get("Date", "N/A")[:10] if finding.get("Date") else "N/A"

            view_link = ""
            if commit != "Latest" and repo_base_url and file != "N/A" and start_line != "N/A": # type: ignore
                clean_file = file.lstrip('/')
                view_link = f"{repo_base_url}/-/blob/{commit}/{clean_file}#L{start_line}"

            findings_data.append({
                "RuleID": rule_id,
                "Description": description,
                "File": file,
                "StartLine": start_line,
                "Secret": secret,
                "Author": author,
                "Date": date,
                "ViewLink": view_link,
            })

        template = self.env.from_string("""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Gitleaks Scan Report</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 0; background: #f8f9fa; color: #333; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
    header h1 { font-size: 24px; color: #111827; }
    header img { height: 40px; }
    .summary-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; padding: 20px 40px; }
    .summary-box { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 5px rgba(0,0,0,0.06); }
    .summary-box h2 { margin-top: 0; font-size: 18px; color: #1e3a8a; }
    .summary-box p, .summary-box ul { font-size: 15px; margin: 6px 0; }
    .category-list { padding-left: 20px; }
    .table-container { padding: 0 40px 40px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
    th, td { padding: 10px; border-bottom: 1px solid #ddd; font-size: 14px; vertical-align: top; word-break: break-word; white-space: normal; }
    th { background-color: #1e3a8a; color: white; }
    tr:hover { background-color: #f3f4f6; }
    .redact { font-family: monospace; color: #b91c1c; white-space: pre-wrap; word-break: break-word; }
    .view-btn { background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; text-decoration: none; font-size: 13px; }
    .truncate { max-height: 3.6em; overflow: hidden; line-height: 1.2em; display: block; position: relative; }
    .expand-toggle { display: inline-block; margin-top: 4px; color: #2563eb; cursor: pointer; font-size: 13px; font-weight: 500; }
  </style>
</head>
<body>

<header>
  <h1>Gitleaks Scan Report</h1>
  <img src="data:image/png;base64,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" alt="Company Logo" />
</header>

<div class="summary-container">
  <div class="summary-box">
    <h2>📋 Project Info</h2>
    <p><strong>Scan ID:</strong> {{ project_uid }}</p>
    <p><strong>Project:</strong> {{ project_name }}</p>
    <p><strong>Branch:</strong> {{ branch if branch else 'N/A' }}</p>
    <p><strong>Commit:</strong> {{ commit }}</p>
    <p><strong>Application SPOC:</strong> {{ spoc if spoc else 'N/A' }}</p>
    <p><strong>Date:</strong> {{ generated_on }}</p>
  </div>

  <div class="summary-box">
    <h2>📊 Leak Summary</h2>
    <p><strong>Total Leaks:</strong> {{ total_leaks }}</p>
    <ul class="category-list">
      {% for rule, count in rule_summary.items() %}
      <li><strong>{{ rule }}</strong>: {{ count }}</li>
      {% endfor %}
    </ul>
  </div>
</div>

<div class="table-container">
  <table>
    <thead>
      <tr>
        <th>Rule</th><th>Description</th><th>File</th><th>Line</th>
        <th>Secret</th><th>Author</th><th>Date</th><th>Action</th>
      </tr>
    </thead>
    <tbody>
      {% for finding in findings_data %}
      <tr>
        <td>{{ finding.RuleID }}</td>
        <td>
          <div class='redact {% if finding.Description|length > 120 %}truncate{% endif %}'>{{ finding.Description }}</div>
          {% if finding.Description|length > 120 %}<span class='expand-toggle' onclick='toggleContent(this)'>Show more</span>{% endif %}
        </td>
        <td>{{ finding.File }}</td>
        <td>{{ finding.StartLine }}</td>
        <td>
          <div class='redact {% if finding.Secret|length > 120 %}truncate{% endif %}'>{{ finding.Secret }}</div>
          {% if finding.Secret|length > 120 %}<span class='expand-toggle' onclick='toggleContent(this)'>Show more</span>{% endif %}
        </td>
        <td>{{ finding.Author }}</td>
        <td>{{ finding.Date }}</td>
        <td>
          {% if finding.ViewLink %}
          <a class='view-btn' href='{{ finding.ViewLink }}' target='_blank'>View</a>
          {% endif %}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>

<script>
  function toggleContent(el) {
    const content = el.previousElementSibling;
    if (content.classList.contains('truncate')) {
      content.classList.remove('truncate');
      el.innerText = "Show less";
    } else {
      content.classList.add('truncate');
      el.innerText = "Show more";
    }
  }
</script>

</body>
</html>
""")

        with open(html_file, 'w') as f:
            f.write(template.render(
                project_uid=project_uid,
                project_name=project_name,
                branch=branch,
                commit=commit,
                spoc=spoc,
                generated_on=generated_on,
                total_leaks=total_leaks,
                rule_summary=rule_summary,
                findings_data=findings_data
            ))
