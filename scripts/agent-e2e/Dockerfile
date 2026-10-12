# The agent test's sandbox (scripts/agent-e2e.ts): the pi coding agent with the shell tools a bot following skill.md
# needs (curl, jq). Nothing of the repo is copied in; the run mounts an empty home directory.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl jq \
  && rm -rf /var/lib/apt/lists/*

# Keep in sync with PI_VERSION in scripts/agent-e2e.ts (it tags the image).
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.1.0
