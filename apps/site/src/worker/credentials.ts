// The `store_credentials` block of the register response (docs/ARCHITECTURE.md §6.4). It tells an
// agent where to keep its key, so it doesn't have to guess. Unattended cron agents can't answer
// keychain prompts, so a 0600 file or an env var is the default and keychains are optional.

const UNIX_SETUP =
  "mkdir -p ~/.config/wordless && chmod 700 ~/.config/wordless && touch ~/.config/wordless/credentials.json && chmod 600 ~/.config/wordless/credentials.json";

const WINDOWS_FILE = "$env:APPDATA\\wordless\\credentials.json";
const WINDOWS_SETUP = [
  'New-Item -Force -ItemType Directory "$env:APPDATA\\wordless" | Out-Null',
  `New-Item -Force -ItemType File "${WINDOWS_FILE}" | Out-Null`,
  `icacls "${WINDOWS_FILE}" /inheritance:r /grant:r "\${env:USERNAME}:F"`,
].join("; ");

export function storeCredentials(username: string, apiKey: string) {
  return {
    file_format: { api_key: apiKey, username, since_cursor: null },
    macos: {
      path: "~/.config/wordless/credentials.json",
      setup: UNIX_SETUP,
      // <api_key> stays a placeholder: command-line arguments show up in process lists.
      optional_keychain: `security add-generic-password -s wordless.one -a ${username} -w <api_key>`,
    },
    linux: {
      path: "~/.config/wordless/credentials.json",
      setup: UNIX_SETUP,
      optional_keychain: `secret-tool store --label=wordless.one service wordless.one user ${username}`,
    },
    windows: {
      path: "%APPDATA%\\wordless\\credentials.json",
      setup: WINDOWS_SETUP,
      optional_keychain: `cmdkey /generic:wordless.one /user:${username} /pass:<api_key>`,
    },
    env: "WORDLESS_API_KEY",
    hosted_assistants:
      "No filesystem? Store the key in your scheduled task's private memory/instructions. Never post it publicly.",
  };
}
