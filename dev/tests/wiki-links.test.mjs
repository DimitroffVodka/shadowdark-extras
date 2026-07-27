import assert from "node:assert/strict";
import {
  access,
  readFile,
  readdir,
} from "node:fs/promises";
import test from "node:test";

const WIKI_DIR = new URL("../../docs/wiki/", import.meta.url);
const PAGE_BASE = "https://github.com/DimitroffVodka/shadowdark-extras/wiki/";
const IMAGE_BASE = "https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("Wiki links use published page routes and valid published images", async () => {
  const entries = await readdir(WIKI_DIR);
  const markdownFiles = entries.filter((name) => name.endsWith(".md"));
  const failures = [];
  let pageLinks = 0;
  let imageLinks = 0;

  for (const filename of markdownFiles) {
    const markdown = await readFile(new URL(filename, WIKI_DIR), "utf8");
    const links = markdown.matchAll(/(!?)\[[^\]]*]\(([^)]+)\)/g);

    for (const match of links) {
      const target = match[2].trim();

      if (target.startsWith(PAGE_BASE)) {
        pageLinks += 1;
        const pageName = target.slice(PAGE_BASE.length).split("#")[0];
        if (!pageName || pageName.endsWith(".md")) {
          failures.push(`${filename}: Wiki page target must be extensionless: ${target}`);
          continue;
        }

        try {
          await access(new URL(`${pageName}.md`, WIKI_DIR));
        } catch {
          failures.push(`${filename}: Wiki page does not exist: ${target}`);
        }
        continue;
      }

      if (target.startsWith(IMAGE_BASE)) {
        imageLinks += 1;
        const imageName = target.slice(IMAGE_BASE.length);

        try {
          const image = await readFile(new URL(`images/${imageName}`, WIKI_DIR));
          if (!image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
            failures.push(`${filename}: Wiki image is not a valid PNG: ${target}`);
          }
        } catch {
          failures.push(`${filename}: Wiki image does not exist: ${target}`);
        }
        continue;
      }

      if (/^https?:/i.test(target) || target.startsWith("#")) {
        continue;
      }

      failures.push(`${filename}: relative link will not route correctly on the Wiki: ${target}`);
    }
  }

  assert.ok(pageLinks > 0, "Expected at least one internal Wiki page link");
  assert.ok(imageLinks > 0, "Expected at least one Wiki image");
  assert.deepEqual(failures, []);
});
