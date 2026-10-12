import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticDocument } from "@/editor/components/static-document";
import { EditorLab } from "./editor-lab";
import { LAB_VARIABLES, LONG_DISCLOSURE } from "./fixtures";

export const metadata: Metadata = { title: "Editor lab" };

// Static page, a 404 in production builds: fixtures only, no request data. The "Server paint" view is rendered
// here, on the server, with <StaticDocument>, to compare against the live editor.
export default function EditorLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <EditorLab
      serverPaint={
        <StaticDocument content={LONG_DISCLOSURE} variables={LAB_VARIABLES} />
      }
    />
  );
}
