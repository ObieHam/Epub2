// ===========================
// CORS Proxy Configuration
// ===========================
const CORS_PROXY = "https://api.allorigins.win/raw?url=";

// ===========================
// DOM Elements
// ===========================
const urlInput = document.getElementById("urlInput");
const convertBtn = document.getElementById("convertBtn");
const statusDiv = document.getElementById("status");

// ===========================
// Event Listeners
// ===========================
convertBtn.addEventListener("click", handleConvert);

// ===========================
// Main Conversion Handler
// ===========================
async function handleConvert() {
  const url = urlInput.value.trim();
  
  if (!url) {
    updateStatus("⚠️ Please enter a URL", "error");
    return;
  }

  if (!url.includes("literotica.com")) {
    updateStatus("⚠️ Only Literotica URLs are supported", "error");
    return;
  }

  convertBtn.disabled = true;
  updateStatus("🔍 Analyzing URL...", "info");

  try {
    // Detect if it's a series or single story
    const chapters = await fetchChapters(url);
    
    if (chapters.length === 0) {
      throw new Error("No chapters found");
    }

    updateStatus(`📚 Found ${chapters.length} chapter(s). Downloading...`, "info");

    // Fetch content for all chapters
    const chapterContents = [];
    for (let i = 0; i < chapters.length; i++) {
      updateStatus(`📖 Downloading chapter ${i + 1}/${chapters.length}...`, "info");
      const content = await fetchChapterContent(chapters[i].url);
      chapterContents.push({
        title: chapters[i].title,
        content: content
      });
    }

    updateStatus("📦 Creating EPUB file...", "info");
    
    // Create EPUB
    const storyTitle = chapterContents[0].title.split(" - ")[0] || "Literotica Story";
    await createEpub(storyTitle, chapterContents);

    updateStatus("✅ EPUB downloaded successfully!", "success");
  } catch (error) {
    console.error("Conversion error:", error);
    updateStatus(`❌ Error: ${error.message}`, "error");
  } finally {
    convertBtn.disabled = false;
  }
}

// ===========================
// Fetch Chapters (Series or Single)
// ===========================
async function fetchChapters(url) {
  const response = await fetch(CORS_PROXY + encodeURIComponent(url));
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Check if it's a series page
  const seriesLinks = doc.querySelectorAll(".ser-ttl a");
  
  if (seriesLinks.length > 0) {
    // It's a series - extract all chapter links
    const chapters = [];
    seriesLinks.forEach(link => {
      chapters.push({
        title: link.textContent.trim(),
        url: link.href.startsWith("http") ? link.href : `https://www.literotica.com${link.getAttribute("href")}`
      });
    });
    return chapters;
  } else {
    // It's a single story
    const titleEl = doc.querySelector("h1");
    const title = titleEl ? titleEl.textContent.trim() : "Untitled Story";
    return [{
      title: title,
      url: url
    }];
  }
}

// ===========================
// Fetch Chapter Content
// ===========================
async function fetchChapterContent(url) {
  const response = await fetch(CORS_PROXY + encodeURIComponent(url));
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract story content
  const contentDiv = doc.querySelector(".aa_ht");
  
  if (!contentDiv) {
    throw new Error("Could not find story content");
  }

  // Clean up the content
  let content = contentDiv.innerHTML;
  
  // Remove scripts and unwanted elements
  content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  
  return content;
}

// ===========================
// Create EPUB File
// ===========================
async function createEpub(title, chapters) {
  const zip = new JSZip();

  // Add mimetype (must be first, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // META-INF folder
  const metaInf = zip.folder("META-INF");
  metaInf.file("container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  // OEBPS folder
  const oebps = zip.folder("OEBPS");

  // Create chapter XHTML files
  chapters.forEach((chapter, index) => {
    const chapterNum = index + 1;
    oebps.file(`chapter${chapterNum}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(chapter.title)}</title>
</head>
<body>
  <h1>${escapeXml(chapter.title)}</h1>
  ${chapter.content}
</body>
</html>`);
  });

  // content.opf
  const chapterManifest = chapters.map((_, i) => 
    `    <item id="chapter${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
  ).join("\n");

  const chapterSpine = chapters.map((_, i) => 
    `    <itemref idref="chapter${i + 1}"/>`
  ).join("\n");

  oebps.file("content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>Literotica Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">literotica-${Date.now()}</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${chapterManifest}
  </manifest>
  <spine toc="ncx">
${chapterSpine}
  </spine>
</package>`);

  // toc.ncx
  const navPoints = chapters.map((chapter, i) => `    <navPoint id="chapter${i + 1}" playOrder="${i + 1}">
      <navLabel>
        <text>${escapeXml(chapter.title)}</text>
      </navLabel>
      <content src="chapter${i + 1}.xhtml"/>
    </navPoint>`).join("\n");

  oebps.file("toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="literotica-${Date.now()}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle>
    <text>${escapeXml(title)}</text>
  </docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`);

  // Generate and download
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `${sanitizeFilename(title)}.epub`);
}

// ===========================
// Utility Functions
// ===========================
function updateStatus(message, type = "info") {
  statusDiv.textContent = message;
  statusDiv.className = type;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}
