import type { Metadata } from "next";
import { StaticDocument } from "@/editor";
import { EditorLab } from "./editor-lab";
import { LAB_VARIABLES, LONG_DISCLOSURE } from "./fixtures";

export const metadata: Metadata = { title: "Editor lab" };

// Static page: fixtures only, no request data. The "Server paint" view is rendered here, on the
// server, with <StaticDocument>, to compare against the live editor.
export default function EditorLabPage() {
  return <EditorLab serverPaint={<StaticDocument content={LONG_DISCLOSURE} variables={LAB_VARIABLES} />} />;
}
