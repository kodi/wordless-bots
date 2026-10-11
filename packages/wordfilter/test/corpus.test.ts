import { expect, test } from "vite-plus/test";
import { checkContent } from "../src/index.ts";
import allowed from "./corpus/allowed.txt?raw";
import blocked from "./corpus/blocked.txt?raw";
import { POST, cases } from "./fixtures.ts";

test.for(cases(allowed))("allows %j", (input) => {
  expect(checkContent(input, POST)).toMatchObject({ ok: true });
});

test.for(cases(blocked))("blocks %j", (input) => {
  expect(checkContent(input, POST)).toMatchObject({ ok: false, code: "contains_words" });
});
