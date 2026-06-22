import type { EvidencePacket } from "@/lib/sema-session/types";
import { concernTypeLabels, signalTypeLabels } from "@/lib/sema-session/types";
import type { RuntimePhotoAttachment } from "@/lib/photo/types";

export type PacketPdfSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

function present(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export function buildPacketPdfSections(packet: EvidencePacket): PacketPdfSection[] {
  const summary = packet.aiOrganizedSummary;
  const sections: PacketPdfSection[] = [
    { title: "Main concern", paragraphs: [present(summary?.mainConcern, "No approved organized summary.")] },
    { title: "Patient's own words", paragraphs: [present(packet.patientWords, "No story provided.")] },
    {
      title: "Organized summary",
      paragraphs: [
        present(summary?.mainConcern, "No summary generated."),
        ...(summary?.summaryNote?.trim() ? [summary.summaryNote] : [])
      ]
    }
  ];

  if (packet.organizedNarrative?.trim()) {
    sections.push({
      title: "Approved packet narrative",
      paragraphs: [packet.organizedNarrative],
      bullets: packet.organizationNotes ?? []
    });
  }

  sections.push(
    {
      title: "Timeline",
      paragraphs: [],
      bullets: summary?.timeline.length
        ? summary.timeline.map((item) => `${item.label}: ${item.detail}`)
        : ["No timeline available."]
    },
    {
      title: "Body/location observations",
      paragraphs: [],
      bullets: packet.bodyLocationObservations.length
        ? packet.bodyLocationObservations.map((item) => [
            item.regionLabel,
            signalTypeLabels[item.signalType],
            item.intensity ? `${item.intensity}/10` : "",
            item.note ?? ""
          ].filter(Boolean).join(" - "))
        : ["No body/location observations added."]
    },
    {
      title: "Audio observations",
      paragraphs: [],
      bullets: packet.audioSignals.length
        ? packet.audioSignals.map((signal) => [
            signal.name,
            `${signal.durationSeconds}s`,
            signal.tags.join(", ") || "No tags",
            signal.notes ?? "",
            signal.transcript ? `Reviewed transcript: ${signal.transcript}` : ""
          ].filter(Boolean).join(" - "))
        : ["No audio observations added."]
    },
    {
      title: "Motion/visual notes",
      paragraphs: [],
      bullets: packet.motionVisualNotes.length ? packet.motionVisualNotes.map((note) => note.note) : ["No motion/visual notes added."]
    },
    {
      title: "Patient-provided photos",
      paragraphs: ["Patient-provided photo · Not clinically analyzed"],
      bullets: packet.photoObservations.filter((photo) => photo.includeInPacket).length
        ? packet.photoObservations.filter((photo) => photo.includeInPacket).map((photo) => [photo.note || "No note added.", photo.bodyLocation ? `Body location: ${photo.bodyLocation}` : "", "Photo availability is limited to the current browser tab."].filter(Boolean).join(" - "))
        : ["No photos approved for this packet."]
    },
    {
      title: "Missing details",
      paragraphs: [],
      bullets: packet.missingDetails.length ? packet.missingDetails : ["No approved missing-detail checklist."]
    },
    {
      title: "Questions for clinician",
      paragraphs: [],
      bullets: packet.clinicianQuestions.length ? packet.clinicianQuestions : ["No approved clinician questions."]
    },
    { title: "Safety note", paragraphs: [packet.safetyNote] },
    { title: "Important disclaimers", paragraphs: [], bullets: packet.limitations }
  );

  return sections;
}

export function packetPdfFilename(generatedAt: string) {
  const parsed = new Date(generatedAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `sema-evidence-packet-${date.toISOString().slice(0, 10)}.pdf`;
}

function pdfSafeText(value: string) {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\u00a0/g, " ");
}

export function fitPhotoWithinBounds(width: number, height: number, maximumWidth: number, maximumHeight: number) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(maximumWidth / width, maximumHeight / height, 1);
  return { width: width * scale, height: height * scale };
}

export async function generateEvidencePacketPdf(packet: EvidencePacket, runtimePhotos: RuntimePhotoAttachment[] = []): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  const footerTop = pageHeight - 42;
  let y = 48;

  function addPage() {
    doc.addPage();
    y = 48;
  }

  function ensureSpace(height: number) {
    if (y + height > footerTop) addPage();
  }

  function wrappedLines(text: string, width = contentWidth) {
    return doc.splitTextToSize(pdfSafeText(text), width) as string[];
  }

  function paragraphHeight(text: string, bullet = false) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    return wrappedLines(text, contentWidth - (bullet ? 13 : 0)).length * 15 + 4;
  }

  function addParagraph(text: string, options?: { bullet?: boolean; bold?: boolean }) {
    const indent = options?.bullet ? 13 : 0;
    const lines = wrappedLines(text, contentWidth - indent);
    doc.setFont("helvetica", options?.bold ? "bold" : "normal");
    doc.setFontSize(10);
    doc.setTextColor(52, 73, 91);
    for (let index = 0; index < lines.length; index += 1) {
      ensureSpace(15);
      if (options?.bullet && index === 0) doc.text("-", margin, y);
      doc.text(lines[index], margin + indent, y);
      y += 15;
    }
    y += 4;
  }

  doc.setFillColor(34, 110, 164);
  doc.roundedRect(margin, y, contentWidth, 78, 7, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("SEMA", margin + 18, y + 25);
  doc.setFontSize(22);
  doc.text("Evidence Packet", margin + 18, y + 52);
  y += 96;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(34, 110, 164);
  doc.text("GENERATED FROM PATIENT-PROVIDED INFORMATION", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(88, 107, 122);
  doc.text(`Generated: ${pdfSafeText(new Date(packet.generatedAt).toLocaleString())}`, margin, y);
  y += 14;
  doc.text(`Concern type: ${packet.concernType ? concernTypeLabels[packet.concernType] : "Not selected"}`, margin, y);
  y += 28;

  for (const section of buildPacketPdfSections(packet)) {
    const sectionHeight = 41
      + section.paragraphs.reduce((height, paragraph) => height + paragraphHeight(paragraph), 0)
      + (section.bullets ?? []).reduce((height, bullet) => height + paragraphHeight(bullet, true), 0);
    if (sectionHeight <= footerTop - 48 && y + sectionHeight > footerTop) addPage();
    else ensureSpace(42);
    doc.setDrawColor(190, 211, 226);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 43, 62);
    doc.text(pdfSafeText(section.title), margin, y);
    y += 18;
    for (const paragraph of section.paragraphs) addParagraph(paragraph, { bold: section.title === "Main concern" });
    for (const bullet of section.bullets ?? []) addParagraph(bullet, { bullet: true });
    y += 5;
  }

  const runtimeById = new Map(runtimePhotos.map((attachment) => [attachment.metadata.id, attachment]));
  for (const photo of packet.photoObservations.filter((item) => item.includeInPacket)) {
    const attachment = runtimeById.get(photo.id);
    ensureSpace(60);
    doc.setDrawColor(190, 211, 226);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;
    addParagraph("Patient-provided photo · Not clinically analyzed", { bold: true });
    if (photo.note) addParagraph(photo.note);
    if (!attachment?.blob) {
      addParagraph("Photo was not retained by Sema after the browser session.");
      continue;
    }
    const fitted = fitPhotoWithinBounds(photo.width, photo.height, contentWidth, 360);
    const imageWidth = Math.max(1, fitted.width);
    const imageHeight = Math.max(1, fitted.height);
    if (y + imageHeight + 10 > footerTop) addPage();
    const bytes = new Uint8Array(await attachment.blob.arrayBuffer());
    doc.addImage(bytes, "JPEG", margin, y, imageWidth, imageHeight, undefined, "FAST");
    bytes.fill(0);
    y += imageHeight + 14;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(210, 222, 231);
    doc.line(margin, footerTop, pageWidth - margin, footerTop);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(98, 116, 130);
    doc.text("Patient-provided information - Not a diagnosis", margin, footerTop + 18);
    doc.text(`Page ${page} of ${pages}`, pageWidth - margin, footerTop + 18, { align: "right" });
  }

  return doc.output("blob");
}

export async function downloadEvidencePacketPdf(packet: EvidencePacket, runtimePhotos: RuntimePhotoAttachment[] = []) {
  const blob = await generateEvidencePacketPdf(packet, runtimePhotos);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = packetPdfFilename(packet.generatedAt);
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return anchor.download;
}
