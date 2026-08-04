"use strict";

// Console formatting. The demo output is the hackathon video, so this leans
// toward being readable by a judge who has never seen the code.

const useColor = !process.env.NO_COLOR && process.stdout.isTTY !== false;

const paint = (code) => (s) => (useColor ? `[${code}m${s}[0m` : String(s));

const c = {
  bold: paint("1"),
  dim: paint("2"),
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  cyan: paint("36"),
  grey: paint("90"),
};

const WIDTH = 68;

function rule(ch = "=") {
  return ch.repeat(WIDTH);
}

function banner(title) {
  console.log("");
  console.log(c.cyan(rule("=")));
  console.log(c.cyan(c.bold(`  ${title}`)));
  console.log(c.cyan(rule("=")));
}

function header(label, title) {
  console.log("");
  console.log(c.bold(rule("-")));
  console.log(c.bold(`  ${label}  ${title}`));
  console.log(c.bold(rule("-")));
}

/// Aligned "key   value" line, so the columns line up down the whole run.
function field(key, value) {
  console.log(`  ${c.grey(key.padEnd(11))}${value}`);
}

function allowed(text) {
  return c.green(`ALLOWED  ${text}`);
}

function blocked(text) {
  return c.red(`BLOCKED  ${text}`);
}

function passed(text) {
  return c.green(`PASSED   ${text}`);
}

function note(text) {
  console.log(c.grey(`  ${text}`));
}

function blank() {
  console.log("");
}

module.exports = { c, rule, banner, header, field, allowed, blocked, passed, note, blank };
