import type { Resume } from '@/types';
import { downloadBlob } from '@/lib/utils';
import { createRoot } from 'react-dom/client';
import React, { useEffect } from 'react';
import ResumeDocument from '@/components/templates/ResumeDocument';

/**
 * A4 PDF export.
 *
 * Renders the same ResumeDocument used by the browser preview.
 *
 * Fixes:
 * 1. Fits the rendered resume onto a single A4 page when exporting.
 * 2. Keeps "View Certificate" / other <a> links clickable in the PDF.
 */
export async function exportResumeToPdf(resume: Resume): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const A4_WIDTH_PX = 794;
  const A4_WIDTH_PT = 595.28;
  const A4_HEIGHT_PT = 841.89;

  const host = document.createElement('div');

  Object.assign(host.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    margin: '0',
    padding: '0',
    background: '#ffffff',
    zIndex: '-9999',
    overflow: 'visible',
    boxSizing: 'border-box',
  });

  document.body.appendChild(host);

  const root = createRoot(host);

  await new Promise<void>((resolve) => {
    const Probe = () => {
      useEffect(() => {
        resolve();
      }, []);

      return React.createElement(ResumeDocument, {
        resume,
        scale: 1,
      });
    };

    root.render(React.createElement(Probe));
  });

  await document.fonts?.ready;
  await new Promise<void>((resolve) => setTimeout(resolve, 150));

  const target = host.firstElementChild as HTMLElement;

  if (!target) {
    root.unmount();
    host.remove();
    throw new Error('Unable to render resume for PDF export.');
  }

  target.style.margin = '0';
  target.style.width = `${A4_WIDTH_PX}px`;
  target.style.transform = 'none';
  target.style.transformOrigin = 'top left';

  // Capture link positions before the temporary DOM is removed.
  const targetRect = target.getBoundingClientRect();
  const links = Array.from(
    target.querySelectorAll<HTMLAnchorElement>('a[href]')
  )
    .map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const href = anchor.href?.trim();

      if (!href || rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      return {
        href,
        leftPx: rect.left - targetRect.left,
        topPx: rect.top - targetRect.top,
        widthPx: rect.width,
        heightPx: rect.height,
      };
    })
    .filter(
      (
        item
      ): item is {
        href: string;
        leftPx: number;
        topPx: number;
        widthPx: number;
        heightPx: number;
      } => Boolean(item)
    );

  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: A4_WIDTH_PX,
    width: A4_WIDTH_PX,
    scrollX: 0,
    scrollY: 0,
  });

  root.unmount();
  host.remove();

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  /*
   * Fit the whole resume to one A4 page.
   *
   * This prevents a tiny leftover section (such as Achievements)
   * from being pushed onto a second page.
   */
  const naturalImageWidthPt = A4_WIDTH_PT;
  const naturalImageHeightPt =
    (canvas.height / canvas.width) * A4_WIDTH_PT;

  const fitScale = Math.min(
    1,
    A4_HEIGHT_PT / naturalImageHeightPt
  );

  const imageWidthPt = naturalImageWidthPt * fitScale;
  const imageHeightPt = naturalImageHeightPt * fitScale;
  const imageX = (A4_WIDTH_PT - imageWidthPt) / 2;
  const imageY = 0;

  const imageData = canvas.toDataURL('image/png');

  pdf.addImage(
    imageData,
    'PNG',
    imageX,
    imageY,
    imageWidthPt,
    imageHeightPt,
    undefined,
    'FAST'
  );

  /*
   * Add real PDF link annotations over the rendered link text.
   * This keeps "View Certificate" clickable instead of only visible.
   */
  const pxToPdf = imageWidthPt / targetRect.width;

  for (const link of links) {
    const x = imageX + link.leftPx * pxToPdf;
    const y = imageY + link.topPx * pxToPdf;
    const w = link.widthPx * pxToPdf;
    const h = link.heightPx * pxToPdf;

    if (w > 0 && h > 0) {
      pdf.link(x, y, w, h, {
        url: link.href,
      });
    }
  }

  const filename = `${(resume.title || 'resume')
    .replace(/[^a-z0-9-_ ]/gi, '_')
    .trim() || 'resume'}.pdf`;

  downloadBlob(pdf.output('blob'), filename);
}
