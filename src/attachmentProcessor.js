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

function matchesPDF(mimeType, ext) {
  return mimeType === "application/pdf" || mimeType === "application/octet-stream" && ext === ".pdf" || ext === ".pdf";
}

function matchesImage(mimeType, ext) {
  return mimeType?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp"].includes(ext);
}

async function commandExists(command) {
  try {
    await execFileAsync("where.exe", [command], { windowsHide: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function extractPdfTextJavaScript(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = fs.readFileSync(filePath);
  const pdf = await pdfjs.getDocument({ data }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const chunk = content.items
      .map(item => (item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (chunk) text += chunk + "\n";
  }
  return text.trim();
}

async function extractImageTextJavaScript(filePath) {
  const Tesseract = (await import("tesseract.js")).default || await import("tesseract.js");
  const result = await Tesseract.recognize(filePath, "spa+eng");
  return (result?.data?.text || "").trim();
}

async function extractLocal(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  const normalizedMime = mimeType || "";

  if (matchesPDF(normalizedMime, ext)) {
    try {
      const text = await extractPdfTextJavaScript(filePath);
      if (text) return { text, extractor: "pdfjs" };
    } catch (err) {
      // Fallback a pdftotext si existe en el sistema.
    }

    if (await commandExists("pdftotext")) {
      try {
        const outputPath = `${filePath}.txt`;
        await execFileAsync("pdftotext", ["-layout", filePath, outputPath], { windowsHide: true, timeout: 60000 });
        return { text: fs.readFileSync(outputPath, "utf8"), extractor: "pdftotext" };
      } catch (err) {
        return { text: "", extractor: null, warning: "No se pudo extraer texto del PDF con pdfjs ni pdftotext." };
      }
    }

    return { text: "", extractor: null, warning: "PDF conservado sin texto extraído. No hay pdftotext ni parser PDF disponible." };
  }

  if (matchesImage(normalizedMime, ext)) {
    try {
      const text = await extractImageTextJavaScript(filePath);
      if (text) return { text, extractor: "tesseract-js" };
    } catch (err) {
      // Fallback a tesseract CLI si está instalado.
    }

    if (await commandExists("tesseract")) {
      try {
        const outputBase = `${filePath}.ocr`;
        await execFileAsync("tesseract", [filePath, outputBase, "-l", "spa+eng"], { windowsHide: true, timeout: 120000 });
        return { text: fs.readFileSync(`${outputBase}.txt`, "utf8"), extractor: "tesseract" };
      } catch (err) {
        return { text: "", extractor: null, warning: "No se pudo OCRizar la imagen con Tesseract." };
      }
    }

    return { text: "", extractor: null, warning: "Imagen conservada sin OCR. No hay Tesseract disponible." };
  }

  return { text: "", extractor: null, warning: "Tipo de adjunto no compatible con extracción local." };
}

async function processAttachments(ticketId, attachments, request, baseUrl = null) {
  const results = [];
  const targetDir = path.join(ATTACHMENTS_DIR, safeName(ticketId));
  await fs.promises.mkdir(targetDir, { recursive: true });

  for (const attachment of attachments || []) {
    const href = attachment.href || "";
    if (!href) continue;

    const label = safeName(attachment.label || attachment.name || "adjunto");
    const resolvedUrl = /^https?:\/\//i.test(href) ? href : new URL(href, baseUrl || "https://glpi.carm.es").toString();
    const filePath = path.join(targetDir, label + (path.extname(href) || path.extname(attachment.label || "") || ""));
    const response = await request.get(resolvedUrl);
    if (!response.ok()) {
      throw new Error(`No se pudo descargar el adjunto ${attachment.label || attachment.href}: HTTP ${response.status()}`);
    }

    const body = await response.body();
    await fs.promises.writeFile(filePath, body);

    const contentType = (response.headers && response.headers()["content-type"]) || attachment.mime || "";
    const extracted = await extractLocal(filePath, contentType);
    results.push({
      ...attachment,
      href: resolvedUrl,
      localPath: filePath,
      extractor: extracted.extractor,
      text: extracted.text,
      warning: extracted.warning || null
    });
  }

  return results;
}

module.exports = { processAttachments, extractLocal };
