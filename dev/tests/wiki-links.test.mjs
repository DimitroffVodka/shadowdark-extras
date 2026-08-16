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

/**
 * Wiki screenshots are WebP since the asset conversion; a few may still be PNG.
 * The ToM walkthrough is a GIF (GitHub wikis strip <video>, so only ![gif]
 * inlines and autoplays). Validate magic bytes match the extension.
 * WebP is RIFF: "RIFF" <size> "WEBP"; GIF is "GIF87a" or "GIF89a".
 */
function imageSignatureError(name, buffer) {
  if (name.toLowerCase().endsWith(".webp")) {
    const isRiff = buffer.subarray(0, 4).toString("latin1") === "RIFF";
    const isWebp = buffer.subarray(8, 12).toString("latin1") === "WEBP";
    return isRiff && isWebp ? null : "is not a valid WebP";
  }
  if (name.toLowerCase().endsWith(".png")) {
    return buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? null : "is not a valid PNG";
  }
  if (name.toLowerCase().endsWith(".gif")) {
    const sig = buffer.subarray(0, 6).toString("latin1");
    return sig === "GIF87a" || sig === "GIF89a" ? null : "is not a valid GIF";
  }
  return "has an unexpected image extension (expected .webp, .png, or .gif)";
}

test("Wiki links use published page routes and valid published images", async () => {
  const entries = await readdir(WIKI_DIR);
  const markdownFiles = entries.filter((name) => name.endsWith(".md"));
  const failures = [];
  let pageLinks = 0;
  let imageLinks = 0;

  for (const filename of markdownFiles) {
    const markdown = await readFile(new URL(filename, WIKI_DIR), "utf8");
    const links = markdown.matchAll(/(!?)\[([^\]]*)]\(([^)]+)\)/g);

    for (const match of links) {
      const isEmbed = match[1] === "!";
      const label = match[2].trim();
      const target = match[3].trim();

      // Alt text is what a reader actually gets when the raw.githubusercontent
      // asset 404s or is blocked, and what a screen reader announces. An image
      // that silently loses it degrades to nothing on the page.
      if (isEmbed && !label) {
        failures.push(`${filename}: Wiki image has no alt text: ${target}`);
      }

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
          const signatureError = imageSignatureError(imageName, image);
          if (signatureError) {
            failures.push(`${filename}: Wiki image ${signatureError}: ${target}`);
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
