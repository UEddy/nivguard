"use strict";

// Replay the canonical recorded run to the terminal, for screen recording.
//
//   npm run demo:replay
//
// Prints the saved console output of the canonical Arc run exactly as
// demo:arc printed it. Makes no network calls, signs nothing, and reads no
// key: it is a transcript, not a run.
//
// The text is not stored here. It is extracted at runtime from the verbatim
// block in docs/DEMO-OUTPUT.md, which is the canonical record of that run, so
// this file cannot drift from the documented output. Colour is re-applied
// using the same agent/log.js helpers the live demo uses, because the stored
// transcript has its escape codes stripped. Content is never modified: there
// is a test that strips the colour back off and asserts the result is byte
// identical to the stored block.

const fs = require("fs");
const path = require("path");

const log = require("../agent/log");
const c = log.c;

const DOC = path.join(__dirname, "..", "docs", "DEMO-OUTPUT.md");
const RECORD = path.join(__dirname, "..", "deployments", "arcTestnet.json");

const HEADING = "## Full console output, verbatim";
// Identifies the transcript fence among any others in that section.
const RUN_MARKER = "NivGuard: onchain spend firewall for AI agents";
const RULE_EQ = "=".repeat(68);
const RULE_DASH = "-".repeat(68);

/// Pull the fenced console block out of the canonical run document.
function loadTranscript() {
  if (!fs.existsSync(DOC)) {
    throw new Error(`Cannot find ${path.relative(process.cwd(), DOC)}`);
  }
  const md = fs.readFileSync(DOC, "utf8").replace(/\r\n/g, "\n");

  const at = md.indexOf(HEADING);
  if (at === -1) {
    throw new Error(`No "${HEADING}" section in docs/DEMO-OUTPUT.md`);
  }

  // Walk every fence in that section and take the one that is actually the
  // run, rather than the first one found. The section also carries a bash
  // fence showing how to replay it, and prose above the transcript is free to
  // grow, so "the next fence" is not a safe anchor.
  let cursor = at;
  for (;;) {
    const open = md.indexOf("\n```", cursor);
    if (open === -1) break;

    const bodyStart = md.indexOf("\n", open + 1) + 1;
    const close = md.indexOf("\n```", bodyStart);
    if (close === -1) throw new Error("Unterminated code fence in docs/DEMO-OUTPUT.md");

    const body = md.slice(bodyStart, close + 1).replace(/\n$/, "");
    if (body.includes(RUN_MARKER)) return body.split("\n");

    cursor = close + 4;
  }

  throw new Error(
    `No fenced block containing "${RUN_MARKER}" under "${HEADING}". ` +
      "The transcript in docs/DEMO-OUTPUT.md is the source for this command."
  );
}

// Field keys are lowercase words, optionally with spaces, left aligned and
// padded to 11 by log.field. Prose notes are not, which is what separates
// "  reason     ..." from "  Revocation is one transaction ...".
const FIELD_KEY = /^[a-z][a-z ]*$/;

function splitField(line) {
  if (!line.startsWith("  ") || line.length < 13) return null;
  const key = line.slice(2, 13);
  const value = line.slice(13);
  if (!value || value.startsWith(" ")) return null;
  const trimmed = key.trimEnd();
  // A continuation line has an empty key, which log.field pads to 11 spaces.
  if (trimmed !== "" && !FIELD_KEY.test(trimmed)) return null;
  if (key !== trimmed.padEnd(11)) return null;
  return { key, value };
}

/// Re-apply the colour the live run emits. Mirrors agent/log.js, and
/// runner.js and demo.js for the values they colour themselves.
function paintValue(key, value) {
  const trailingNote = (s) => s.replace(/(\s)(\([^()]*\))$/, (_, sp, note) => sp + c.grey(note));

  if (value.startsWith("ALLOWED  ")) return c.green(trailingNote(value));
  if (value.startsWith("BLOCKED  ")) return c.red(trailingNote(value));
  if (value.startsWith("PASSED   ")) return c.green(value);
  if (value.startsWith("runner error:")) return c.red(value);
  if (value === "agent is revoked, no further spending possible") return c.red(value);

  const k = key.trimEnd();
  if (k === "action") return c.yellow(value);
  // "0x...  (allowlisted)" and "0x...  (PRIVATE_KEY)" carry a grey aside.
  if (k === "merchant" || k === "owner" || k === "network") return trailingNote(value);
  return value;
}

function paintLine(line, i, lines) {
  if (line === RULE_EQ) return c.cyan(line);
  if (line === RULE_DASH) return c.bold(line);

  const between = (rule) => lines[i - 1] === rule && lines[i + 1] === rule;
  if (between(RULE_EQ)) return c.cyan(c.bold(line));
  if (between(RULE_DASH)) return c.bold(line);

  // Summary verdicts: "  PASSED   PAYMENT 1   " / "  BLOCKED  PAYMENT 2   KEY"
  const verdict = line.match(/^ {2}(PASSED |BLOCKED)( {2})(.{1,12})(.*)$/);
  if (verdict) {
    const [, word, gap, label, rest] = verdict;
    const painted = word === "PASSED " ? c.green(word) : c.red(word);
    return `  ${painted}${gap}${label}${rest.trim() ? rest.replace(/(\S.*)$/, (m) => c.grey(m)) : rest}`;
  }

  // "  3 allowed and 4 blocked out of 7 attempts."
  const tally = line.match(/^ {2}(\d+ allowed) and (\d+ blocked) (out of \d+ attempts\.)$/);
  if (tally) return `  ${c.green(tally[1])} and ${c.red(tally[2])} ${tally[3]}`;

  const field = splitField(line);
  if (field) return `  ${c.grey(field.key)}${paintValue(field.key, field.value)}`;

  // Everything else indented by two spaces is a note, printed entirely grey.
  if (/^ {2}\S/.test(line)) return c.grey(line);

  return line;
}

function main() {
  const lines = loadTranscript();
  const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));

  // One line, so nobody can mistake this for a live run.
  console.log(
    c.yellow(
      `RECORDED RUN, replayed from docs/DEMO-OUTPUT.md, no network calls: ` +
        `Arc testnet chainId ${record.chainId}, firewall ${record.spendFirewall}, ` +
        `agent ${record.demoAgent}`
    )
  );

  for (let i = 0; i < lines.length; i++) {
    console.log(paintLine(lines[i], i, lines));
  }
}

module.exports = { loadTranscript, paintLine, main };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("");
    console.error(`Replay failed: ${err.message}`);
    process.exitCode = 1;
  }
}
