import type { Metadata } from "next";
import { DeviceGallery } from "./gallery";

export const metadata: Metadata = { title: "Phone previews" };

// Dev-only gallery for the phone kit (src/components/device), on fixtures. Not linked from the app. A static
// page: no deep links. The rail mock at the top settles the message channels' preview controls at the
// tightest well; the sections below show every view at 1:1 and in that well.
export default function DevicePage() {
  return <DeviceGallery />;
}
