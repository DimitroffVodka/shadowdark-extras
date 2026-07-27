import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WIKI_URL = "https://github.com/DimitroffVodka/shadowdark-extras/wiki";

/**
 * Extract one version's section from a Keep a Changelog-style document.
 *
 * @param {string} changelog
 * @param {string} tag A version with or without a leading "v".
 * @returns {string}
 */
export function extractReleaseNotes(changelog, tag) {
  const version = String(tag ?? "").trim().replace(/^v/, "");
  if (!version) {
    throw new Error("A release tag is required.");
  }

  const lines = String(changelog ?? "").replace(/\r\n/g, "\n").split("\n");
  const headingPattern = /^## \[([^\]]+)\](?:\s|$)/;
  const start = lines.findIndex((line) => headingPattern.exec(line)?.[1] === version);

  if (start === -1) {
    throw new Error(`CHANGELOG.md has no section for [${version}].`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingPattern.test(lines[index])) {
      end = index;
      break;
    }
  }

  const sectionBody = lines.slice(start + 1, end).join("\n").trim();
  if (!sectionBody) {
    throw new Error(`CHANGELOG.md section [${version}] is empty.`);
  }

  const section = [lines[start], sectionBody].join("\n\n");
  return `${section}\n\n---\n\n[Read the Shadowdark Extras Wiki](${WIKI_URL})\n`;
}

async function main() {
  const [, , tag, outputPath] = process.argv;
  if (!tag) {
    throw new Error("Usage: node dev/extract-release-notes.mjs <tag> [output-file]");
  }

  const changelog = await readFile(resolve("CHANGELOG.md"), "utf8");
  const notes = extractReleaseNotes(changelog, tag);

  if (outputPath) {
    await writeFile(resolve(outputPath), notes, "utf8");
    return;
  }

  process.stdout.write(notes);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(`release-notes: ${error.message}`);
    process.exitCode = 1;
  });
}
