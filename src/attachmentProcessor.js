"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");

function safeName(value) {
  return String(value || "adjunto").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function commandExists(command) {
  try {
    await execFileAsync("where.exe", [command], { windowsHide: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function extractLocal(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (mimeType === "application/pdf" || ext === ".pdf") {
    if (!await commandExists("pdftotext")) {
      return { text: "", extractor: null, warning: "pdftotext no está instalado; PDF conservado sin texto extraído." };
    }
    const outputPath = `${filePath}.txt`;
    await execFileAsync("pdftotext", ["-layout", filePath, outputPath], { windowsHide: true, timeout: 60000 });
    return { text: fs.readFileSync(outputPath, "utf8"), extractor: "pdftotext" };
  }

  if (mimeType?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"].includes(ext)) {
    if (!await commandExists("tesseract")) {
      return { text: "", extractor: null, warning: "tesseract no está instalado; imagen conservada sin OCR." };
    }
    const outputBase = `${filePath}.ocr`;
    await execFileAsync("tesseract", [filePath, outputBase, "-l", "spa+eng"], { windowsHide: true, timeout: 120000 });
    return { text: fs.readFileSync(`${outputBase}.txt`, "utf8"), extractor: "tesseract" };
  }

  return { text: "", extractor: null, warning: "Tipo de adjunto no compatible con extracción local." };
}

async function processAttachments(ticketId, attachments, request) {
  const results = [];
  const targetDir = path.join(ATTACHMENTS_DIR, safeName(ticketId));
  await fs.promises.mkdir(targetDir, { recursive: true });

  for (const attachment of attachments || []) {
    const label = safeName(attachment.label || "adjunto");
    const filePath = path.join(targetDir, label);
    const response = await request.get(attachment.href);
    if (!response.ok()) {
      throw new Error(`No se pudo descargar el adjunto ${attachment.label || attachment.href}: HTTP ${response.status()}`);
    }
    await fs.promises.writeFile(filePath, await response.body());
    const extracted = await extractLocal(filePath, response.headers()["content-type"]);
    results.push({
      ...attachment,
      localPath: filePath,
      extractor: extracted.extractor,
      text: extracted.text,
      warning: extracted.warning || null
    });
  }

  return results;
}

module.exports = { processAttachments, extractLocal };
