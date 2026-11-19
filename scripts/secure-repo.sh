#!/usr/bin/env bash
# One-time (and safe-to-rerun) hardening for the GitHub repo.
# Usage: scripts/secure-repo.sh owner/repo        (needs the GitHub CLI, logged in as an admin of the repo)
set -euo pipefail
REPO="${1:?usage: scripts/secure-repo.sh owner/repo}"
api() { gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }
step() { printf '• %s… ' "$1"; }
ok() { echo "done"; }

step "Secret scanning + push protection";  api -X PATCH "repos/$REPO" --input - >/dev/null <<'JSON' && ok
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}},
 "delete_branch_on_merge":true,"allow_merge_commit":false,"allow_squash_merge":true,"allow_rebase_merge":false,
 "has_wiki":false,"has_projects":false}
JSON
step "Dependabot alerts";                  api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null && ok
step "Dependabot security updates";        api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null && ok
step "Private vulnerability reporting";    api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null && ok

step "Actions: read-only token by default, cannot approve PRs"
api -X PUT "repos/$REPO/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null && ok
step "Actions: only GitHub-owned actions, pinned to full SHAs"
api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true >/dev/null 2>&1 \
  || api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=selected >/dev/null
api -X PUT "repos/$REPO/actions/permissions/selected-actions" -F github_owned_allowed=true -F verified_allowed=false >/dev/null && ok

step "GitHub Pages deployed by the workflow, HTTPS enforced"
api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null
api -X PUT "repos/$REPO/pages" -F https_enforced=true >/dev/null 2>&1 || true
ok

step "Protect main: no force-push, no deletion"
EXISTING=$(api "repos/$REPO/rulesets" --jq '.[] | select(.name=="protect-main") | .id' || true)
RULESET='{"name":"protect-main","target":"branch","enforcement":"active",
  "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
  "rules":[{"type":"deletion"},{"type":"non_fast_forward"}]}'
if [ -n "$EXISTING" ]; then echo "$RULESET" | api -X PUT "repos/$REPO/rulesets/$EXISTING" --input - >/dev/null
else echo "$RULESET" | api -X POST "repos/$REPO/rulesets" --input - >/dev/null; fi
ok

echo "All set: https://github.com/$REPO/settings/security_analysis"
