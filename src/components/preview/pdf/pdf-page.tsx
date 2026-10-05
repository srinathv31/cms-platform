"use client";

import { memo, useCallback, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { PageSize } from "./page-layers";
import styles from "./pdf-viewer.module.css";

interface PdfPageProps {
  index: number;
  count: number;
  size: PageSize;
  /** Hands the slot element to the controller, which fills it with the canvas and the text layer. */
  register: (index: number, el: HTMLElement | null) => void;
}

/**
 * One page: a sheet of paper with the page's exact aspect ratio, so it holds its place before it is
 * drawn. React owns the box and its label; its children belong to the controller.
 */
export const PdfPage = memo(function PdfPage({ index, count, size, register }: PdfPageProps) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      register(index, el);
      return () => register(index, null);
    },
    [index, register],
  );

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Page ${index + 1} of ${count}`}
      data-page-number={index + 1}
      className={cn(styles.page, "relative w-full bg-white ring-1 ring-hairline")}
      style={
        {
          aspectRatio: `${size.width} / ${size.height}`,
          "--scale-factor": `calc(var(--pdf-px) / ${size.width})`,
          "--user-unit": size.userUnit,
        } as CSSProperties
      }
    />
  );
});
