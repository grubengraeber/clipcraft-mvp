import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const artifactsDir = join(projectRoot, "artifacts", "screenshots");
const dataDir = join(projectRoot, ".clipcraft-screenshot-data");
const port = Number(process.env.SCREENSHOT_PORT || 3210);
const host = "127.0.0.1";
const baseUrl = process.env.SCREENSHOT_BASE_URL || `http://${host}:${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const buildIdPath = join(projectRoot, ".next", "BUILD_ID");
const serverMode =
  process.env.SCREENSHOT_SERVER_MODE ||
  (existsSync(buildIdPath) ? "start" : "dev");

let server = null;
let browser = null;

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  await rm(dataDir, { recursive: true, force: true });

  if (!process.env.SCREENSHOT_BASE_URL) {
    server = spawn("npm", ["run", serverMode, "--", "-p", String(port), "-H", host], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CLIPCRAFT_DATA_DIR: dataDir,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    server.stdout.on("data", (chunk) => process.stdout.write(chunk));
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    await waitForServer(baseUrl);
  }

  browser = await chromium.launch({
    executablePath: existsSync(chromePath) ? chromePath : undefined,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem("clipcraft_locale", "de");
  });
  const saved = [];

  async function capture(name) {
    const filePath = join(artifactsDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    saved.push(filePath);
  }

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Anmelden ohne Passwort" }).waitFor();
  await capture("00-login-otp");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("heading", { name: "Sign in without a password" }).waitFor();
  await capture("00c-login-otp-en");
  await page.getByRole("button", { name: "DE", exact: true }).click();
  await page.getByRole("heading", { name: "Anmelden ohne Passwort" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("00b-login-otp-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByLabel("E-Mail").fill("mira@example.com");
  await page.getByRole("button", { name: /Login-Code senden/ }).click();
  const otp = (await page.getByTestId("dev-otp-code").textContent())?.trim();
  if (!otp) {
    throw new Error("Lokaler OTP-Code wurde nicht angezeigt.");
  }
  await page.getByLabel("6-stelliger Code").fill(otp);
  await page.getByRole("button", { name: /^Anmelden$/ }).click();
  await page.getByRole("heading", { name: "Workspace anlegen" }).waitFor();
  await capture("01-onboarding-profile");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("01b-onboarding-profile-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByLabel("Name").fill("Mira Schaefer");
  await page.getByLabel("Workspace").fill("Mira Studio");
  await page.getByRole("button", { name: /^Weiter/ }).click();
  await page.getByRole("heading", { name: "Workflow einstellen" }).waitFor();
  await capture("02-onboarding-workflow");

  await page.getByRole("button", { name: /Batch Export/ }).click();
  await page.getByRole("button", { name: /^Plan$/ }).click();
  await page.getByRole("heading", { name: "Plan aktivieren" }).waitFor();
  await page.getByRole("button", { name: /Studio/ }).first().click();
  await capture("03-onboarding-payment");

  await page.getByRole("button", { name: /Testzahlung aktivieren/ }).click();
  await page.getByRole("heading", { name: "Thumbnail Studio" }).waitFor({
    timeout: 15000,
  });
  await capture("04-studio-dashboard");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("04b-studio-dashboard-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: /Projekte/ }).click();
  await page.getByRole("heading", { name: "Alle Videos und Thumbnails" }).waitFor();
  await capture("05-project-archive");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        screenshots: saved,
      },
      null,
      2,
    ),
  );
}

async function waitForServer(url) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error(
    `Server unter ${url} wurde nicht rechtzeitig bereit.${lastError ? ` Letzter Fehler: ${lastError.message}` : ""}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (server) {
      server.kill();
    }
  });
