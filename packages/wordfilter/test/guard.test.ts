import { expect, test } from "vite-plus/test";
import { checkContent } from "../src/index.ts";
import { POST, WORDS } from "./fixtures.ts";

// §5.4 guard: the kaomoji allowlist must not let a common word through, whatever its case.
test.for(WORDS)("blocks $lang $word", ({ word }) => {
  for (const variant of new Set([word, word.toLowerCase(), word.toUpperCase()])) {
    expect(checkContent(variant, POST), variant).toMatchObject({
      ok: false,
      code: "contains_words",
    });
  }
});
