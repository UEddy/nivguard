"use strict";

// The replay is a recording asset: npm run demo:replay is screen recorded as
// if it were a live run. So the thing worth testing is that colouring the
// stored transcript never changes a single character of it, and that the
// transcript is still findable in docs/DEMO-OUTPUT.md after someone edits
// that file.

const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const { loadTranscript, paintLine } = require("../scripts/replayDemo");

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(ANSI, "");

describe("demo:replay", function () {
  let lines;

  before(function () {
    lines = loadTranscript();
  });

  it("finds the verbatim block in docs/DEMO-OUTPUT.md", function () {
    expect(lines.length).to.be.greaterThan(50);
    expect(lines.join("\n")).to.include("NivGuard: onchain spend firewall for AI agents");
    expect(lines.join("\n")).to.include("3 allowed and 4 blocked out of 7 attempts.");
  });

  it("colouring changes no content whatsoever", function () {
    for (let i = 0; i < lines.length; i++) {
      expect(strip(paintLine(lines[i], i, lines))).to.equal(lines[i]);
    }
  });

  it("actually applies colour", function () {
    const painted = lines.map((l, i) => paintLine(l, i, lines));
    const coloured = painted.filter((l) => ANSI.test(l)).length;
    expect(coloured).to.be.greaterThan(lines.length / 4);
  });

  it("replays the canonical agent, not the dashboard's live agent", function () {
    const record = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "deployments", "arcTestnet.json"), "utf8")
    );
    const text = lines.join("\n");
    expect(text.toLowerCase()).to.include(record.demoAgent.toLowerCase());
    expect(text).to.include(record.spendFirewall);
  });

  it("pulls in nothing that could touch the network", function () {
    // Loading the replay must not drag in a provider, a signer or dotenv.
    const loaded = Object.keys(require.cache).map((m) => m.toLowerCase());
    const viaReplay = loaded.filter((m) => m.includes("replaydemo"));
    expect(viaReplay.length).to.equal(1);

    const src = fs.readFileSync(
      path.join(__dirname, "..", "scripts", "replayDemo.js"), "utf8"
    );
    expect(src).to.not.match(/require\(["'](ethers|dotenv)/);
    expect(src).to.not.include("makeProvider");
  });
});
