"use client"

import jsPDF from "jspdf"
import html2canvas from "html2canvas"

/**
 * Captures a DOM element by its ID and downloads it as a PDF ticket.
 * Built for high-fidelity dark-mode POS ticket rendering.
 * 
 * @param elementId The HTML ID of the container to snapshot
 * @param filename  The default downloaded filename
 */
export async function downloadElementAsPDF(elementId: string, filename: string = "recibo.pdf") {
  const element = document.getElementById(elementId)
  if (!element) {
    console.error(`Element with ID ${elementId} not found.`)
    return
  }

  try {
    // 1. Capture the element exactly as it looks (scales for Retina displays)
    const canvas = await html2canvas(element, {
      scale: 2,         // High resolution
      useCORS: true,    // Allow loading external images like avatars
      backgroundColor: "#18181B" // Enforce dark background to match Cronix UI
    })

    const imgData = canvas.toDataURL("image/png")

    // 2. Calculate aspect ratio to fit the PDF
    const pdfWidth = canvas.width / 2 // adjusting for scale: 2
    const pdfHeight = canvas.height / 2
    
    const pdf = new jsPDF({
      orientation: pdfWidth > pdfHeight ? "landscape" : "portrait",
      unit: "px",
      format: [pdfWidth, pdfHeight]
    })

    // 3. Bake the image into the PDF
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight)

    // 4. Trigger browser download
    pdf.save(filename)
  } catch (error) {
    console.error("Failed to generate PDF:", error)
  }
}
