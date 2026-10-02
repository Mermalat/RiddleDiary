import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReplyMarkdown } from "../reply-safety";

test("model images, reference links, vault embeds and raw HTML stay literal", () => {
  assert.equal(safeReplyMarkdown('![pixel](https://example.test/private) ![[note]] <img src="https://example.test/x">'), '!\\[pixel\\](https://example.test/private) !\\[\\[note\\]\\] &lt;img src="https://example.test/x"&gt;');
  assert.equal(safeReplyMarkdown('[click](javascript:alert(1))\n![image][ref]\n[ref]: https://example.test/x'), '\\[click\\](javascript:alert(1))\n!\\[image\\]\\[ref\\]\n\\[ref\\]: https://example.test/x');
  for (let count = 0; count < 5; count++) assert.equal(safeReplyMarkdown(`${"\\".repeat(count)}[x](file:///private)`), '\\[x\\](file:///private)');
});

test("actual code remains literal while invalid code delimiters cannot hide active markup", () => {
  const code = '<img src="https://example.test/x"> ![x](url) [0]';
  assert.equal(safeReplyMarkdown(`\`\`${code}\`\``), `\`\`${code}\`\``);
  assert.equal(safeReplyMarkdown(`\`\`\`html\n${code}\n\`\`\``), `\`\`\`html\n${code}\n\`\`\``);
  assert.ok(safeReplyMarkdown(`\`\`\`invalid\`\n${code}`).includes('&lt;img'));
  assert.ok(safeReplyMarkdown(`\\\`${code}\``).includes('&lt;img'));
  assert.ok(safeReplyMarkdown(`\`\`${code}\``).includes('&lt;img'));
});

test("stream prefixes stay safe and unfinished fences stay closed", () => {
  const input = '![track](https://example.test/x)\n<img src="https://example.test/y">';
  for (let end = 0; end <= input.length; end++) {
    const safe = safeReplyMarkdown(input.slice(0, end));
    assert.ok(!safe.includes('![') && !safe.includes('<img'));
  }
  assert.equal(safeReplyMarkdown('**bold**\n```html\n<img>'), '**bold**\n```html\n<img>\n```');
  assert.equal(safeReplyMarkdown('before\n---\nafter'), 'before\n***\nafter');
});

test("many code spans are processed without quadratic delimiter searches", { timeout: 2000 }, () => {
  const prefix = "`literal` ".repeat(50_000);
  assert.equal(safeReplyMarkdown(prefix + "![x](url)"), prefix + "!\\[x\\](url)");
});
