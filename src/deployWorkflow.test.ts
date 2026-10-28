/**
 * A merge to main must deploy to the VPS, and nothing else should.
 *
 * The deploy workflow existed only for Azure, was `workflow_dispatch`-only, and
 * had no VPS job at all, so a merge deployed nothing. This pins the
 * replacement, because the failure mode it guards is silent — a workflow that
 * does not run looks exactly like a workflow with nothing to deploy.
 *
 * The same contract is asserted in the five Python site repos as
 * `tests/test_deploy_workflow.py`. It is duplicated rather than shared because
 * there is no shared test runner between a Vite/vitest frontend repo and five
 * pytest repos, and a deploy guard that only exists in one of the six is a
 * deploy guard that exists in one of the six.
 *
 * This repo has no scheduled job that commits to main, so there is nothing to
 * exclude by name. `checkNoCatchAll` is the invariant that still bites here:
 * a bare `**` in the filter would match every commit, so any refresh job added
 * later would redeploy the service on every run.
 *
 * The one check here that is not a copy from a sibling is the credential.
 * `checkCredential` asserts `secrets.GHCR_PAT`, and it exists because the
 * original version asserted the opposite. Requiring `secrets.GITHUB_TOKEN` here
 * would have failed on the first merge with
 * `denied: permission_denied: write_package` *after* a clean build, because
 * ghcr.io/kevinsigey/sports-predictor is user-scoped and not linked to this
 * repository. That is indistinguishable from a permissions bug and is not one.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const WORKFLOW_DIR = join(REPO, ".github", "workflows");
const WORKFLOW = join(WORKFLOW_DIR, "deploy.yml");

/** Must match `image:` in vps-stack/compose.yml. */
const IMAGE = "ghcr.io/kevinsigey/sports-predictor";
/** Must match the service key in vps-stack/compose.yml. */
const SERVICE = "sports";

/** Baked into the image (the Dockerfile is `COPY . .`) and hand-committed. */
const MUST_DEPLOY = [
  "src/**",
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "Caddyfile",
  "Dockerfile",
  ".github/workflows/deploy.yml",
];

const GATE_AZURE = "vars.DEPLOY_AZURE == 'true'";
const GATE_VPS = "vars.VPS_HOST != ''";

const text = (): string => readFileSync(WORKFLOW, "utf8");

/** The `jobs:` block as {name: body}, so a gate can be read per job. */
function jobs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name: string | null = null;
  let buf: string[] = [];
  let inJobs = false;
  for (const line of src.split("\n")) {
    if (/^jobs:[ \t]*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const m = /^ {2}([A-Za-z0-9_-]+):[ \t]*$/.exec(line);
    if (m) {
      if (name !== null) out[name] = buf.join("\n");
      name = m[1];
      buf = [];
    } else if (name !== null) {
      buf.push(line);
    }
  }
  if (name !== null) out[name] = buf.join("\n");
  return out;
}

/** The `paths:` entries of the push trigger. */
function pathsFilter(src: string): string[] {
  const start = /^on:[ \t]*$/m.exec(src);
  expect(start, "the workflow has no top-level `on:` block").not.toBeNull();
  const block: string[] = [];
  for (const line of src.slice(start!.index + start![0].length).split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#") || line.startsWith(" ") || line.startsWith("\t")) {
      block.push(line);
    } else break;
  }
  const p = /^[ \t]+paths:\n((?:[ \t]+-[ \t]*.+\n)+)/m.exec(block.join("\n"));
  expect(p, "the push trigger has no `paths:` filter, so every commit deploys").not.toBeNull();
  return p![1]
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.trim().replace(/^-\s*/, "").replace(/^['"]|['"]$/g, ""));
}

const checkTriggers = (src: string): void => {
  expect(/^[ \t]+workflow_dispatch:/m.test(src), "workflow_dispatch is gone").toBe(true);
  expect(/^[ \t]+push:[ \t]*$/m.test(src), "the workflow does not run on push").toBe(true);
  expect(
    /^[ \t]+branches:[ \t]*\[?[ \t]*main/m.test(src),
    "the push trigger is not limited to main",
  ).toBe(true);
  const paths = pathsFilter(src);
  for (const required of MUST_DEPLOY) {
    expect(paths, `${required} is not watched, so a change to it deploys nothing: ${paths}`).toContain(required);
  }
};

const checkNoCatchAll = (src: string): void => {
  for (const p of pathsFilter(src)) {
    expect(
      ["**", ".", "*", ""],
      `the paths filter contains ${JSON.stringify(p)}, which matches every commit`,
    ).not.toContain(p);
  }
};

/**
 * The GHCR login must use a credential this repository can actually push with.
 *
 * `GITHUB_TOKEN` would be the target state — a PAT is a credential that outlives
 * the repo and has to be rotated by hand — but it may only write to packages
 * LINKED to its own repository, and ghcr.io/kevinsigey/sports-predictor is not:
 *
 *     gh api /user/packages/container/sports-predictor --jq '.repository.full_name'
 *     -> null
 *
 * So the push dies with `denied: permission_denied: write_package` after the
 * image has already built and tagged correctly, which looks exactly like a
 * permissions problem: `packages: write` is declared, and it is correct. NFL and
 * CFB both lost their first deploy this way. Linking a package is a one-time
 * action in package settings with no API, so nothing in CI can notice.
 *
 * The PAT is already a secret on this repo and is what these images have always
 * been pushed with. If that `gh api` ever returns
 * "Kevocado/Sports_Predictor", switch the workflow back to
 * `secrets.GITHUB_TOKEN` and change this check in the same commit.
 *
 * Matched on the `password:` field rather than the name appearing anywhere, so
 * the workflow's own comment can say what the alternative would be. Exactly one,
 * so a second login step cannot smuggle in a second credential.
 */
const checkCredential = (src: string): void => {
  const body = jobs(src).build;
  const passwords = [...body.matchAll(/password:[ \t]*\$\{\{[ \t]*secrets\.([A-Z0-9_]+)[ \t]*\}\}/g)].map(
    (m) => m[1],
  );
  // `toEqual` already rejects every case the removed raw-body `not.toMatch` was
  // there for: `["GITHUB_TOKEN"]` (GITHUB_TOKEN cannot write to an unlinked
  // package -- it fails with `denied: permission_denied: write_package` after a
  // clean build, which reads like a permissions problem and is not one) and
  // `["GHCR_PAT", "GITHUB_TOKEN"]` (two logins). What it cannot do is read the
  // workflow's own comment, which has to be able to name the alternative.
  expect(
    passwords,
    `GHCR login must use secrets.GHCR_PAT, and only it, while the package is not linked to ` +
      `this repo; found ${JSON.stringify(passwords)}. GITHUB_TOKEN cannot write to an unlinked ` +
      `package: it fails with \`denied: permission_denied: write_package\` after a clean build, ` +
      `which reads like a permissions problem and is not one. Re-check with \`gh api ` +
      `/user/packages/container/sports-predictor --jq '.repository.full_name'\`: if it returns a ` +
      `repository, this workflow and this check should both move to GITHUB_TOKEN.`,
  ).toEqual(["GHCR_PAT"]);
};

const checkImage = (src: string): void => {
  const j = jobs(src);
  expect(Object.keys(j), "no `build` job to produce the image").toContain("build");
  const body = j.build;
  expect(body, "the build job never logs in to a registry").toContain("docker/login-action");
  expect(body, "the registry is not ghcr.io").toMatch(/registry:[ \t]*ghcr\.io/);
  expect(body, `the build must push ${IMAGE}:\${{ github.sha }}`).toContain(`${IMAGE}:\${{ github.sha }}`);
  expect(body, `the build must also push ${IMAGE}:latest`).toContain(`${IMAGE}:latest`);
};

const checkVps = (src: string): void => {
  const j = jobs(src);
  const found = Object.entries(j)
    .filter(([, b]) => b.includes("vars.VPS_HOST"))
    .map(([n]) => n);
  expect(found.length, `expected exactly one VPS job, found ${found}`).toBe(1);
  const body = j[found[0]];
  expect(
    body,
    "the VPS job must need `build`, or it can restart the stack on an image that was never pushed",
  ).toMatch(/^[ \t]+needs:[ \t]*build[ \t]*$/m);
  expect(body, `the VPS job must be gated on \`${GATE_VPS}\``).toMatch(
    new RegExp(`^[ \\t]+if:[ \\t]*${GATE_VPS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "m"),
  );
  expect(
    body,
    `the VPS job must serialise on concurrency: vps-deploy-${SERVICE}`,
  ).toMatch(new RegExp(`^[ \\t]+concurrency:[ \\t]*vps-deploy-${SERVICE}[ \\t]*$`, "m"));
  expect(body, "VPS_SSH_KEY is never used").toMatch(/\$\{\{[ \t]*secrets\.VPS_SSH_KEY[ \t]*\}\}/);
  expect(body, "VPS_KNOWN_HOSTS is never used, so the host is not verified").toMatch(
    /\$\{\{[ \t]*secrets\.VPS_KNOWN_HOSTS[ \t]*\}\}/,
  );
  const expected = `ssh deploy@\${{ vars.VPS_HOST }} deploy ${SERVICE} \${{ github.sha }}`;
  expect(body, `the deploy command must be exactly: ${expected}`).toContain(expected);
  expect(
    body.indexOf("known_hosts"),
    "known_hosts is written after the ssh call, so the job hangs on a host prompt",
  ).toBeLessThan(body.indexOf("ssh deploy@"));
};

const checkAzureFailsClosed = (src: string): void => {
  expect(
    src.includes("DEPLOY_AZURE != 'false'"),
    "`vars.DEPLOY_AZURE != 'false'` fails OPEN: any repo that has not set the variable turns Azure back on",
  ).toBe(false);
  const j = jobs(src);
  const azure = Object.entries(j).filter(([, b]) => /^[ \t]*(az[ \t]|.*azure\/login|.*containerapp)/m.test(b));
  expect(azure.length, "the Azure deploy steps are gone entirely").toBeGreaterThan(0);
  for (const [name, body] of azure) {
    expect(
      body,
      `job ${name} touches Azure but is not gated on \`${GATE_AZURE}\``,
    ).toMatch(new RegExp(`^[ \\t]+if:[ \\t]*${GATE_AZURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "m"));
  }
};

const checkYamlShape = (src: string): void => {
  src.split("\n").forEach((line, i) => {
    const stripped = line.replace(/^ +/, "");
    const indent = line.length - stripped.length;
    if (stripped) {
      expect(indent % 2, `line ${i + 1} is indented ${indent} spaces: ${JSON.stringify(line)}`).toBe(0);
    }
  });
  for (const m of src.matchAll(/^[ \t]+steps:[ \t]*$/gm)) {
    const after = src.slice(m.index! + m[0].length).replace(/^\n/, "");
    const first = after.split("\n")[0] ?? "";
    expect(
      first.startsWith("      - "),
      `a \`steps:\` block whose first item is not at six spaces: ${JSON.stringify(first)}`,
    ).toBe(true);
  }
};

const checkNoSecretMaterial = (src: string): void => {
  for (const m of src.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
    expect(m[1], `secret ${m[1]} is not a UPPER_CASE name`).toMatch(/^[A-Z0-9_]+$/);
  }
  for (const marker of ["BEGIN OPENSSH PRIVATE KEY", "BEGIN RSA PRIVATE KEY", "ghp_", "github_pat_"]) {
    expect(src.includes(marker), `the workflow contains credential material (${marker})`).toBe(false);
  }
  for (const line of src.split("\n")) {
    expect(
      line.includes("secrets.") && (line.includes("echo") || line.includes("::")),
      `a secret reaches the log: ${line.trim()}`,
    ).toBe(false);
  }
};

const CHECKS: Record<string, (s: string) => void> = {
  triggers: checkTriggers,
  catchall: checkNoCatchAll,
  credential: checkCredential,
  image: checkImage,
  vps: checkVps,
  azure: checkAzureFailsClosed,
  shape: checkYamlShape,
  secrets: checkNoSecretMaterial,
};

describe("the VPS auto-deploy workflow", () => {
  it("exists", () => {
    expect(statSync(WORKFLOW).isFile(), `${WORKFLOW} is missing; a merge deploys nothing`).toBe(true);
    expect(text().length).toBeGreaterThan(400);
  });

  it("can fail every check it makes", () => {
    // A guard that cannot fail is not a guard. Each mutation must be a string
    // that appears exactly once, or it is not breaking what it claims to.
    const good = text();
    const mutations: Record<string, [string, string]> = {
      triggers: ["workflow_dispatch:", "workflow_DISABLED:"],
      catchall: [`'${MUST_DEPLOY[0]}'`, "'**'"],
      // A third credential, neither of the two the linkage allows. This is the
      // mutation the `image` check used to carry, back when the credential
      // assertion lived inside it.
      credential: ["secrets.GHCR_PAT", "secrets.REGISTRY_TOKEN"],
      // The registry, which appears exactly once. The image name cannot be used
      // as the anchor (it is on four lines) and neither tag can: the sha tag is
      // on the build line and the push line, and `:latest` likewise, so
      // mutating one leaves `checkImage`'s substring assertion satisfied by the
      // other occurrence.
      image: ["registry: ghcr.io", "registry: quay.io"],
      vps: [`deploy ${SERVICE} \${{ github.sha }}`, `deploy ${SERVICE}`],
      azure: [GATE_AZURE, "vars.DEPLOY_AZURE != 'false'"],
      shape: [`concurrency: vps-deploy-${SERVICE}`, ` concurrency: vps-deploy-${SERVICE}`],
      secrets: ["secrets.GHCR_PAT", "secrets.ghcr_pat"],
    };
    for (const [name, check] of Object.entries(CHECKS)) {
      expect(() => check(good), `the real workflow fails the ${name} check`).not.toThrow();
      const [from, to] = mutations[name];
      expect(good.split(from).length - 1, `the ${name} mutation is not unique`).toBe(1);
      expect(
        () => check(good.replace(from, to)),
        `the ${name} check passed a workflow with ${from} broken`,
      ).toThrow();
    }
  });

  it("deploys on a merge to main", () => checkTriggers(text()));
  it("has no catch-all in the paths filter", () => checkNoCatchAll(text()));
  it("pushes with a credential this repo can use", () => checkCredential(text()));
  it("builds and pushes the image the stack pulls", () => checkImage(text()));
  it("reaches the VPS and asks for this service", () => checkVps(text()));
  it("leaves Azure off unless asked", () => checkAzureFailsClosed(text()));
  it("has sane YAML indentation", () => checkYamlShape(text()));
  it("contains no secret material", () => checkNoSecretMaterial(text()));
});

describe("the refresh jobs cannot loop the deploy", () => {
  it("has no other workflow committing a watched path", () => {
    // This repo has no scheduled job, so this asserts the absence rather than
    // classifying anything. If a refresh job is added later, this fails and the
    // overlap has to be decided on purpose.
    const watched = pathsFilter(text());
    const others = readdirSync(WORKFLOW_DIR)
      .filter((n) => /\.ya?ml$/.test(n) && n !== "deploy.yml")
      .filter((n) => statSync(join(WORKFLOW_DIR, n)).isFile());
    for (const name of others) {
      const body = readFileSync(join(WORKFLOW_DIR, name), "utf8").replace(/\\\n/g, " ");
      for (const m of body.matchAll(/git add\s+(.*)/g)) {
        for (const token of m[1].split(/\s+/)) {
          const p = token.replace(/^['"]|['"]$/g, "");
          if (p.startsWith("-") || (!p.includes("/") && !p.endsWith(".json"))) continue;
          for (const pattern of watched) {
            expect(
              watched.includes(p),
              `${name} commits ${p}, watched via ${pattern}. Classify it: exclude it, or record why a scheduled commit should redeploy.`,
            ).toBe(false);
          }
        }
      }
    }
    expect(relative(REPO, WORKFLOW)).toBe(".github/workflows/deploy.yml");
  });
});
