// Every name doczi reads from a project, the home folder or the environment.
// The legacy solo-keel names are still read until v0.3 (docs/adr/0001-rename-to-doczi.md);
// the new name always wins. The PHP and Python servers and the commit-msg hook mirror these.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_FILE = ".doczi.json";
export const LEGACY_CONFIG_FILE = ".solo-keel.json";
const HOME_DIR = ".doczi";
const LEGACY_HOME_DIR = ".solo-keel";

export function env(name) {
  return process.env[`DOCZI_${name}`] || process.env[`SOLO_KEEL_${name}`] /* legacy */ || "";
}

export const home = () => env("HOME") || path.join(os.homedir(), HOME_DIR);
export const legacyHome = () => path.join(os.homedir(), LEGACY_HOME_DIR);

// Where the registry is read from: the home folder, else the legacy one, but only while neither
// the environment names a home nor ~/.doczi exists (so removed projects stay removed).
export function registryFiles() {
  const files = [path.join(home(), "projects.json")];
  if (!env("HOME") && !fs.existsSync(home())) files.push(path.join(legacyHome(), "projects.json"));
  return files;
}
